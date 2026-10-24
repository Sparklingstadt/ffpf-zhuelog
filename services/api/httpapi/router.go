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
	_ Entries = (*store.Store)(nil)
	_ Follows = (*store.Store)(nil)
	_ Pinger  = (*store.Store)(nil)

	_ Accounts       = (*store.Store)(nil)
	_ PasswordHasher = (*auth.PasswordVerifier)(nil)
)

// Auth is what the handlers need from *auth.Service.
type Auth interface {
	LoginGitHub(ctx context.Context, code, verifier, redirectURI string) (auth.TokenPair, error)
	LoginPassword(ctx context.Context, client, loginID, password string) (auth.TokenPair, error)
	Refresh(ctx context.Context, token string) (auth.TokenPair, error)
	Logout(ctx context.Context, token string) error
	Authenticate(ctx context.Context, accessToken string) (auth.Principal, error)
	ChangePassword(ctx context.Context, p auth.Principal, current, next, confirm string) error
	LoginGuest(ctx context.Context) (auth.TokenPair, error)
	Me(ctx context.Context, p auth.Principal) (auth.Me, error)
	ActAs(ctx context.Context, p auth.Principal, ownerID string) (auth.Principal, error)
}

// Entries is what the handlers need from *store.Store.
type Entries interface {
	ListEntries(ctx context.Context, ownerID string, after *store.Cursor, limit int) ([]store.Entry, error)
	CountEntries(ctx context.Context, ownerID string) (int, error)
	GetEntry(ctx context.Context, ownerID, id string) (store.Entry, error)
	CreateBatch(ctx context.Context, ownerID string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error)
	CreateImportBatch(ctx context.Context, ownerID, fileName string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error)
	UpdateEntry(ctx context.Context, ownerID, id string, p store.EntryPatch) (store.Entry, error)
	TrashEntry(ctx context.Context, ownerID, id string, now time.Time) error
	ListTrashed(ctx context.Context, ownerID string, after *store.Cursor, limit int) ([]store.TrashedEntry, error)
	CountTrashed(ctx context.Context, ownerID string) (int, error)
	RestoreEntry(ctx context.Context, ownerID, id string) (store.Entry, error)
	PurgeEntry(ctx context.Context, ownerID, id string) error
	EmptyTrash(ctx context.Context, ownerID string) (int, error)
	SetShared(ctx context.Context, ownerID, id string, shared bool, now time.Time) (store.Entry, error)
	ListLogDates(ctx context.Context, ownerID string) ([]store.LogDateCount, error)
	ListDailyEntries(ctx context.Context, ownerID string, d store.LogDate) ([]store.Entry, error)
	GetDailyEntry(ctx context.Context, ownerID string, d store.LogDate, number int) (store.Entry, int, error)
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

// Pinger checks that the database is reachable.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Deps are the router's collaborators. A nil Logger means slog.Default() and a
// nil Now means time.Now.
type Deps struct {
	Auth    Auth
	Entries Entries
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
	// Line serves the LINE routes; nil means LINE is not configured and the
	// routes are not registered. LineChannelSecret verifies webhook
	// signatures and CronSecret guards GET /v1/line/drain.
	Line              LineService
	LineChannelSecret []byte
	CronSecret        []byte
	// Chat serves the admin chat and its saved conversations; nil means
	// OpenAI is not configured and the routes are not registered. ChatModel
	// is the model name the conversation list reports.
	Chat          ChatStreamer
	Conversations Conversations
	ChatModel     string
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
	pattern   string
	authed    bool // behind requireAuth
	allowUser bool // accepts ?user= (only the five read routes)
	// allowGuest lets guest tokens through requireAuth. It is the only place
	// that records it: every other authed route answers guests with 403.
	allowGuest bool
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
// must already have its defaults applied.
func newMux(d Deps) (*http.ServeMux, []route) {
	mux := http.NewServeMux()
	var routes []route
	handle := func(rt route, h http.Handler) {
		routes = append(routes, rt)
		mux.Handle(rt.pattern, h)
	}
	// public registers a route that needs no authentication.
	public := func(pattern string, h http.Handler) { handle(route{pattern: pattern}, h) }
	// limited applies the per-client rate limit.
	limiter := NewRateLimiter(authRateLimit, authRateWindow, d.Now)
	clientKey := clientKeyFunc(d.WebProxySecret)
	limited := func(h http.Handler) http.Handler { return rateLimit(limiter, clientKey, h) }
	// refreshLimited is the separate per-client limit for POST /v1/auth/refresh.
	refreshLimiter := NewRateLimiter(refreshRateLimit, authRateWindow, d.Now)
	refreshLimited := func(h http.Handler) http.Handler { return rateLimit(refreshLimiter, clientKey, h) }
	// authed requires a valid token and rejects ?user= with 400; the safe default.
	authed := func(h http.Handler) http.Handler { return requireAuth(d.Auth, false, rejectUserParam(h)) }
	// authedAllowUser requires a valid token and lets read handlers honour ?user=.
	authedAllowUser := func(h http.Handler) http.Handler { return requireAuth(d.Auth, false, h) }
	// adminOnly is authed plus a 403 for non-admins.
	adminOnly := func(h http.Handler) http.Handler { return authed(requireAdmin(h)) }
	// private registers an authed route; privateReadUser one that accepts ?user=.
	private := func(pattern string, h http.Handler) { handle(route{pattern: pattern, authed: true}, h) }
	privateReadUser := func(pattern string, h http.Handler) {
		handle(route{pattern: pattern, authed: true, allowUser: true}, h)
	}

	// Production and the ALB health check use /health; /healthz is kept for
	// local use.
	health := healthz(d.DB)
	public("GET /health", health)
	public("GET /healthz", health)
	// The ALB health check uses /ping, which does not touch the database: a
	// DB check every few seconds would keep Neon from ever suspending, and a
	// database outage would make ECS replace healthy tasks.
	public("GET /ping", ping())

	public("POST /v1/auth/github", limited(loginGitHub(d.Auth)))
	public("POST /v1/auth/password", limited(loginPassword(d.Auth, clientKey)))
	public("POST /v1/auth/refresh", refreshLimited(refresh(d.Auth)))
	public("POST /v1/auth/logout", limited(logout(d.Auth)))
	// With a proxy secret configured, only the web server may start guest
	// sessions; without one (local development) anyone may.
	public("POST /v1/auth/guest", limited(requireProxySecret(d.WebProxySecret, loginGuest(d.Auth))))

	// The only route guests may call: it tells the web who is signed in.
	handle(route{pattern: "GET /v1/me", authed: true, allowGuest: true},
		requireAuth(d.Auth, true, rejectUserParam(me(d.Auth))))

	// Only these five read routes accept ?user=; every other authed route
	// rejects it with 400 so it can never be mistaken for being honoured.
	privateReadUser("GET /v1/entries", authedAllowUser(listEntries(d.Entries)))
	privateReadUser("GET /v1/entries/{id}", authedAllowUser(getEntry(d.Entries)))
	privateReadUser("GET /v1/log-dates", authedAllowUser(listLogDates(d.Entries)))
	privateReadUser("GET /v1/log-dates/{date}/entries", authedAllowUser(listDailyEntries(d.Entries)))
	privateReadUser("GET /v1/log-dates/{date}/entries/{number}", authedAllowUser(getDailyEntry(d.Entries)))

	private("POST /v1/batches", authed(createBatch(d.Entries, d.Now)))
	// CSV import into the caller's own notes (admin and member). Its body
	// limit is 4 MiB + 256 KiB instead of 1 MiB; see limitBody.
	private("POST "+csvImportPath, authed(importCSV(d.Entries, d.Now)))
	private("PATCH /v1/entries/{id}", authed(patchEntry(d.Entries)))
	private("DELETE /v1/entries/{id}", authed(deleteEntry(d.Entries, d.Now)))
	private("GET /v1/trash", authed(listTrash(d.Entries)))
	private("DELETE /v1/trash", authed(emptyTrash(d.Entries)))
	private("POST /v1/trash/{id}/restore", authed(restoreEntry(d.Entries)))
	private("DELETE /v1/trash/{id}", authed(purgeEntry(d.Entries)))
	private("PUT /v1/entries/{id}/share", authed(shareEntry(d.Entries, d.Now, true)))
	private("DELETE /v1/entries/{id}/share", authed(shareEntry(d.Entries, d.Now, false)))
	private("GET /v1/members", authed(listMembers(d.Follows)))
	private("PUT /v1/follows/{ownerId}", authed(followMember(d.Follows, d.Now)))
	private("DELETE /v1/follows/{ownerId}", authed(unfollowMember(d.Follows)))
	private("GET /v1/timeline", authed(listTimeline(d.Follows)))
	// Changing a password checks the current one, so it shares the /v1/auth/*
	// limit. The limit runs before authentication so failed tokens count too.
	private("POST /v1/account/password", limited(authed(changePassword(d.Auth))))
	// Admin-only member management. Passwords are hashed with the shared
	// scrypt semaphore and are never logged.
	private("GET /v1/admin/accounts", adminOnly(listAccounts(d.Accounts)))
	private("POST /v1/admin/accounts", adminOnly(createAccount(d.Accounts, d.Hasher, d.Now)))
	private("POST /v1/admin/accounts/{id}/password", adminOnly(resetAccountPassword(d.Accounts, d.Hasher, d.Now)))

	// The LINE routes exist only when the bot is configured. The webhook and
	// the drain are public but check their own credential (the LINE signature,
	// the cron secret); the three link routes are for members and admins, and
	// closed while an admin acts as a member, so the admin's LINE account is
	// never tied to the member.
	if d.Line != nil {
		public("POST "+lineWebhookPath, lineWebhook(d.Line, d.LineChannelSecret, d.Now))
		public("GET "+lineDrainPath, lineDrain(d.Line, d.CronSecret, d.Now))
		private("GET /v1/line/link", authed(notActing(lineLinked(d.Line))))
		private("POST /v1/line/link-code", authed(notActing(lineLinkCode(d.Line))))
		private("DELETE /v1/line/link", authed(notActing(lineUnlink(d.Line))))
	}

	// The admin chat exists only when OpenAI is configured.
	if d.Chat != nil {
		private("POST /v1/chat", adminOnly(streamChat(d.Chat)))
		private("GET /v1/conversations", adminOnly(listConversations(d.Conversations, d.ChatModel)))
		private("GET /v1/conversations/{id}", adminOnly(getConversation(d.Conversations)))
		private("PUT /v1/conversations/{id}", adminOnly(putConversation(d.Conversations, d.Now)))
		private("DELETE /v1/conversations/{id}", adminOnly(deleteConversation(d.Conversations)))
	}

	return mux, routes
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
