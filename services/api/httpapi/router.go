package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

var _ Pinger = (*store.Store)(nil)

// Pinger checks that the database is reachable.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Deps are the router's collaborators. A nil Logger means slog.Default() and a
// nil Now means time.Now.
type Deps struct {
	DB     Pinger
	Logger *slog.Logger
	Now    func() time.Time
}

const pingTimeout = 3 * time.Second

// route records how a pattern was registered, so tests can check every route.
type route struct {
	pattern string
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
// must already have its defaults applied. Only the health routes are left:
// sign-in moved to the web in stage 11 of the Go retirement.
func newMux(d Deps) (*http.ServeMux, []route) {
	r := &registrar{d: d, mux: http.NewServeMux()}
	r.healthRoutes()
	return r.mux, r.routes
}

// registrar holds the mux and the route table.
type registrar struct {
	d      Deps
	mux    *http.ServeMux
	routes []route
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
