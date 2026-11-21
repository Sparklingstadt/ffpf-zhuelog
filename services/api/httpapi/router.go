package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

var (
	_ Auth    = (*auth.Service)(nil)
	_ Follows = (*store.Store)(nil)
	_ Pinger  = (*store.Store)(nil)

	_ Throttle = (*store.Store)(nil)

	_ Accounts       = (*store.Store)(nil)
	_ PasswordHasher = (*auth.PasswordVerifier)(nil)
)

// Auth is what the handlers need from *auth.Service.
type Auth interface {
	LoginGitHub(ctx context.Context, code, verifier, redirectURI string) (auth.TokenPair, error)
	LoginFFPF(ctx context.Context, code, verifier, redirectURI, nonce string) (auth.TokenPair, error)
	LoginPassword(ctx context.Context, client, loginID, password string) (auth.TokenPair, error)
	Refresh(ctx context.Context, token string) (auth.TokenPair, error)
	Logout(ctx context.Context, token string) error
	Authenticate(ctx context.Context, accessToken string) (auth.Principal, error)
	ChangePassword(ctx context.Context, p auth.Principal, current, next, confirm string) error
	LoginGuest(ctx context.Context) (auth.TokenPair, error)
	Me(ctx context.Context, p auth.Principal) (auth.Me, error)
	ActAs(ctx context.Context, p auth.Principal, ownerID string) (auth.Principal, error)
	DemoEnabled() bool
	LoginDemo(ctx context.Context, client string) (auth.TokenPair, error)
	IsDemo(ctx context.Context, p auth.Principal) (bool, error)
}

// Follows is what the handlers need from *store.Store for the member
// directory, follows and the timeline.
type Follows interface {
	ListMembers(ctx context.Context, viewerID string) (store.MemberDirectory, error)
	MemberExists(ctx context.Context, ownerID string) (bool, error)
	Follow(ctx context.Context, followerID, followeeID string, now time.Time) error
	Unfollow(ctx context.Context, followerID, followeeID string) error
	ListTimeline(ctx context.Context, viewerID string, after *store.Cursor, limit int) ([]store.TimelineItem, error)
}

// Accounts is what the handlers need from *store.Store for admin member
// management.
type Accounts interface {
	ListPasswordAccounts(ctx context.Context) ([]store.AccountSummary, error)
	CreatePasswordAccount(ctx context.Context, loginID, displayName, hash string, now time.Time) (store.AccountSummary, error)
	FindPasswordAccountByID(ctx context.Context, id string) (store.PasswordAccount, error)
	SetPassword(ctx context.Context, id, hash string, now time.Time) error
}

// Throttle is the fixed-window counter in the database (*store.Store), so a
// limit holds across every instance of the API rather than per process.
type Throttle interface {
	ConsumeThrottle(ctx context.Context, key string, limit int, window time.Duration, now time.Time) (bool, error)
}

// Pinger checks that the database is reachable.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Deps are the router's collaborators. A nil Logger means slog.Default() and a
// nil Now means time.Now.
type Deps struct {
	Auth    Auth
	Follows Follows
	// Accounts and Hasher serve the admin routes.
	Accounts Accounts
	Hasher   PasswordHasher
	DB       Pinger
	Logger   *slog.Logger
	Now      func() time.Time
	// WebProxySecret, when non-empty, lets the Next.js web server forward the
	// end user's IP (see clientKeyFunc).
	WebProxySecret []byte
	// Throttle counts the per-client limits of the sign-in routes and of
	// refresh; nil counts them in this process only (local runs and tests).
	Throttle Throttle
	// Line serves the LINE routes; nil means LINE is not configured and the
	// routes are not registered. LineChannelSecret verifies webhook
	// signatures and CronSecret guards GET /v1/line/drain.
	Line              LineService
	LineChannelSecret []byte
	CronSecret        []byte
	// StudyLog counts what owners did each day.
	StudyLog StudyLog
	// AIUsage sums up the tokens of the OpenAI calls for the admin; nil
	// leaves the summary route out.
	AIUsage AIUsage
	// DemoReset puts the demo account back to its fixture; nil (no demo)
	// leaves its cron route out. CronSecret guards it.
	DemoReset DemoResetter
}

const (
	authRateLimit  = 10
	authRateWindow = time.Minute
	// Refresh has its own, looser limit: the web proxy refreshes for every
	// signed-in tab, and a refresh needs a valid 256-bit token anyway.
	refreshRateLimit = 60
	pingTimeout      = 3 * time.Second
)

// route records how a pattern was registered, so tests can check every route.
type route struct {
	pattern string
	authed  bool // behind requireAuth
	// allowGuest lets guest tokens through requireAuth. It is the only place
	// that records it: every other authed route answers guests with 403.
	allowGuest bool
	// closedToDemo answers the demo account with 403 (see notDemo).
	closedToDemo bool
}

// NewRouter builds the API handler with all middleware applied.
func NewRouter(d Deps) http.Handler {
	d = d.withDefaults()
	mux, _ := newMux(d)
	return wrap(d, jsonMuxErrors(mux))
}

func (d Deps) withDefaults() Deps {
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	if d.Now == nil {
		d.Now = time.Now
	}
	return d
}

// newMux registers every route and returns the mux with the route table. d
// must already have its defaults applied. Each feature registers its own
// routes; a feature whose collaborator is nil is left out (404).
func newMux(d Deps) (*http.ServeMux, []route) {
	r := newRegistrar(d)
	r.healthRoutes()
	r.authRoutes()
	r.demoRoutes()
	r.meRoute()
	r.memberRoutes()
	r.accountRoutes()
	r.adminRoutes()
	r.studyLogRoutes()
	r.lineRoutes()
	return r.mux, r.routes
}

// registrar holds the mux, the route table and the wrappers every feature
// registers its routes with.
type registrar struct {
	d      Deps
	mux    *http.ServeMux
	routes []route

	clientKey func(*http.Request) string
	// limited applies the per-client /v1/auth/* rate limit; refreshLimited is
	// the separate, looser one for POST /v1/auth/refresh.
	limited        func(http.Handler) http.Handler
	refreshLimited func(http.Handler) http.Handler
}

func newRegistrar(d Deps) *registrar {
	clientKey := clientKeyFunc(d.WebProxySecret)
	limiter := newLimiter(d.Throttle, "route:auth:", authRateLimit, authRateWindow, d.Now)
	refreshLimiter := newLimiter(d.Throttle, "route:refresh:", refreshRateLimit, authRateWindow, d.Now)
	return &registrar{
		d:              d,
		mux:            http.NewServeMux(),
		clientKey:      clientKey,
		limited:        func(h http.Handler) http.Handler { return rateLimit(limiter, clientKey, h) },
		refreshLimited: func(h http.Handler) http.Handler { return rateLimit(refreshLimiter, clientKey, h) },
	}
}

func (r *registrar) handle(rt route, h http.Handler) {
	r.routes = append(r.routes, rt)
	r.mux.Handle(rt.pattern, h)
}

// public registers a route that needs no authentication.
func (r *registrar) public(pattern string, h http.Handler) { r.handle(route{pattern: pattern}, h) }

// authed requires a valid token and rejects ?user= with 400; the safe default.
func (r *registrar) authed(h http.Handler) http.Handler {
	return requireAuth(r.d.Auth, false, rejectUserParam(h))
}

// private registers an authed route.
func (r *registrar) private(pattern string, h http.Handler) {
	r.handle(route{pattern: pattern, authed: true}, r.authed(h))
}

// adminOnly registers an authed route that answers non-admins with 403.
func (r *registrar) adminOnly(pattern string, h http.Handler) { r.private(pattern, requireAdmin(h)) }

// notForDemo registers an authed route the demo account may not use: one
// that calls OpenAI, reaches other members or changes the account.
func (r *registrar) notForDemo(pattern string, h http.Handler) {
	r.notForDemoWrapped(pattern, r.authed, h)
}

// notForDemoWrapped is notForDemo with its own wrapper instead of authed; h
// is the handler before authentication and wrap goes around it.
func (r *registrar) notForDemoWrapped(pattern string, wrap func(http.Handler) http.Handler, h http.Handler) {
	r.handle(route{pattern: pattern, authed: true, closedToDemo: true}, wrap(notDemo(r.d.Auth, h)))
}

func (r *registrar) healthRoutes() {
	// /health checks the database too; /healthz is kept for local use.
	health := healthz(r.d.DB)
	r.public("GET /health", health)
	r.public("GET /healthz", health)
	// /ping does not touch the database, for frequent liveness checks (for
	// example a container health check): a DB check every few seconds would
	// keep Neon from ever suspending.
	r.public("GET /ping", ping())
}

func (r *registrar) authRoutes() {
	a := r.d.Auth
	r.public("POST /v1/auth/github", r.limited(loginGitHub(a)))
	r.public("POST /v1/auth/ffpf", r.limited(loginFFPF(a)))
	r.public("POST /v1/auth/password", r.limited(loginPassword(a, r.clientKey)))
	r.public("POST /v1/auth/refresh", r.refreshLimited(refresh(a)))
	r.public("POST /v1/auth/logout", r.limited(logout(a)))
	// With a proxy secret configured, only the web server may start guest
	// sessions; without one (local development) anyone may.
	r.public("POST /v1/auth/guest", r.limited(requireProxySecret(r.d.WebProxySecret, loginGuest(a))))
}

// demoRoutes: whether the demo account exists (for the sign-in page), a
// session for it (no password and only from the web, like guests), and its
// nightly reset when a DemoReset is configured.
func (r *registrar) demoRoutes() {
	r.public("GET /v1/auth/demo", demoStatus(r.d.Auth))
	r.public("POST /v1/auth/demo", r.limited(requireProxySecret(r.d.WebProxySecret, loginDemo(r.d.Auth, r.clientKey))))
	if r.d.DemoReset != nil {
		// Vercel Cron calls with GET; POST is for running it by hand.
		reset := demoReset(r.d.DemoReset, r.d.CronSecret, r.d.Now)
		r.public("GET "+demoResetPath, reset)
		r.public("POST "+demoResetPath, reset)
	}
}

// meRoute is the only route guests may call: it tells the web who is signed
// in.
func (r *registrar) meRoute() {
	r.handle(route{pattern: "GET /v1/me", authed: true, allowGuest: true},
		requireAuth(r.d.Auth, true, rejectUserParam(me(r.d.Auth))))
}

// memberRoutes are the member directory, follows and the timeline. They reach
// other members, so the demo account (shared by strangers) has none of them.
func (r *registrar) memberRoutes() {
	f, now := r.d.Follows, r.d.Now
	r.notForDemo("GET /v1/members", listMembers(f))
	r.notForDemo("PUT /v1/follows/{ownerId}", followMember(f, now))
	r.notForDemo("DELETE /v1/follows/{ownerId}", unfollowMember(f))
	r.notForDemo("GET /v1/timeline", listTimeline(f))
}

func (r *registrar) accountRoutes() {
	// Changing a password checks the current one, so it shares the /v1/auth/*
	// limit. The limit runs before authentication so failed tokens count too.
	r.notForDemoWrapped("POST /v1/account/password",
		func(h http.Handler) http.Handler { return r.limited(r.authed(h)) }, changePassword(r.d.Auth))
}

// adminRoutes are member management (passwords are hashed with the shared
// scrypt semaphore and are never logged) and, when recorded, the AI usage
// summary.
func (r *registrar) adminRoutes() {
	r.adminOnly("GET /v1/admin/accounts", listAccounts(r.d.Accounts))
	r.adminOnly("POST /v1/admin/accounts", createAccount(r.d.Accounts, r.d.Hasher, r.d.Now))
	r.adminOnly("POST /v1/admin/accounts/{id}/password", resetAccountPassword(r.d.Accounts, r.d.Hasher, r.d.Now))
	if r.d.AIUsage != nil {
		r.adminOnly("GET /v1/admin/ai-usage", aiUsageMonth(r.d.AIUsage, r.d.Now))
	}
}

// studyLogRoutes are the study log, for members and admins.
func (r *registrar) studyLogRoutes() {
	if r.d.StudyLog != nil {
		r.private("GET /v1/study-log", listStudyLog(r.d.StudyLog))
	}
}

// lineRoutes exist only when the bot is configured. The webhook and the drain
// are public but check their own credential (the LINE signature, the cron
// secret); the link routes are for members and admins, and closed while an
// admin acts as a member, so the admin's LINE account is never tied to the
// member.
func (r *registrar) lineRoutes() {
	l := r.d.Line
	if l == nil {
		return
	}
	r.public("POST "+lineWebhookPath, lineWebhook(l, r.d.LineChannelSecret, r.d.Now))
	r.public("GET "+lineDrainPath, lineDrain(l, r.d.CronSecret, r.d.Now))
	r.notForDemo("GET /v1/line/link", notActing(lineLinked(l)))
	r.notForDemo("POST /v1/line/link-code", notActing(lineLinkCode(l)))
	r.notForDemo("DELETE /v1/line/link", notActing(lineUnlink(l)))
	r.notForDemo("PUT /v1/line/review-notify", notActing(lineReviewNotify(l, true)))
	r.notForDemo("DELETE /v1/line/review-notify", notActing(lineReviewNotify(l, false)))
}

func ping() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

func healthz(db Pinger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if db != nil {
			ctx, cancel := context.WithTimeout(r.Context(), pingTimeout)
			defer cancel()
			if err := db.Ping(ctx); err != nil {
				loggerFrom(r.Context()).Warn("health check failed", "error", err.Error())
				writeError(w, http.StatusServiceUnavailable, codeUnavailable, msgUnavailable)
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

// jsonMuxErrors keeps ServeMux's routing and status codes but answers its
// unmatched-route 404 and 405 responses in the JSON error shape.
func jsonMuxErrors(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h, pattern := mux.Handler(r); pattern == "" {
			c := &captureWriter{header: http.Header{}}
			h.ServeHTTP(c, r)
			switch c.status {
			case http.StatusNotFound:
				writeError(w, http.StatusNotFound, codeNotFound, msgNotFound)
				return
			case http.StatusMethodNotAllowed:
				if allow := c.header.Get("Allow"); allow != "" {
					w.Header().Set("Allow", allow)
				}
				writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, msgMethodNotAllowed)
				return
			}
			// Anything else (a path-cleaning redirect) is served as is.
		}
		mux.ServeHTTP(w, r)
	})
}

// captureWriter records a handler's status and headers and drops its body.
type captureWriter struct {
	header http.Header
	status int
}

func (c *captureWriter) Header() http.Header { return c.header }

func (c *captureWriter) WriteHeader(code int) {
	if c.status == 0 {
		c.status = code
	}
}

func (c *captureWriter) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.status = http.StatusOK
	}
	return len(b), nil
}
