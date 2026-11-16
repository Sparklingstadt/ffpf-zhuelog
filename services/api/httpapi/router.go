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
	_ Auth   = (*auth.Service)(nil)
	_ Pinger = (*store.Store)(nil)

	_ Throttle = (*store.Store)(nil)
)

// Auth is what the handlers need from *auth.Service.
type Auth interface {
	LoginGitHub(ctx context.Context, code, verifier, redirectURI string) (auth.TokenPair, error)
	LoginFFPF(ctx context.Context, code, verifier, redirectURI, nonce string) (auth.TokenPair, error)
	LoginPassword(ctx context.Context, client, loginID, password string) (auth.TokenPair, error)
	Refresh(ctx context.Context, token string) (auth.TokenPair, error)
	Logout(ctx context.Context, token string) error
	Authenticate(ctx context.Context, accessToken string) (auth.Principal, error)
	LoginGuest(ctx context.Context) (auth.TokenPair, error)
	Me(ctx context.Context, p auth.Principal) (auth.Me, error)
	ActAs(ctx context.Context, p auth.Principal, ownerID string) (auth.Principal, error)
	DemoEnabled() bool
	LoginDemo(ctx context.Context, client string) (auth.TokenPair, error)
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
	Auth   Auth
	DB     Pinger
	Logger *slog.Logger
	Now    func() time.Time
	// WebProxySecret, when non-empty, lets the Next.js web server forward the
	// end user's IP (see clientKeyFunc).
	WebProxySecret []byte
	// Throttle counts the per-client limits of the sign-in routes and of
	// refresh; nil counts them in this process only (local runs and tests).
	Throttle Throttle
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

// demoRoutes: whether the demo account exists (for the sign-in page) and a
// session for it (no password and only from the web, like guests). The web
// resets the account every night (stage 10b of the Go retirement).
func (r *registrar) demoRoutes() {
	r.public("GET /v1/auth/demo", demoStatus(r.d.Auth))
	r.public("POST /v1/auth/demo", r.limited(requireProxySecret(r.d.WebProxySecret, loginDemo(r.d.Auth, r.clientKey))))
}

// meRoute is the only route guests may call: it tells the web who is signed
// in.
func (r *registrar) meRoute() {
	r.handle(route{pattern: "GET /v1/me", authed: true, allowGuest: true},
		requireAuth(r.d.Auth, true, rejectUserParam(me(r.d.Auth))))
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
