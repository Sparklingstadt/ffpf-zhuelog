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
)

// Auth is what the handlers need from *auth.Service.
type Auth interface {
	LoginGitHub(ctx context.Context, code, verifier, redirectURI string) (auth.TokenPair, error)
	LoginPassword(ctx context.Context, loginID, password string) (auth.TokenPair, error)
	Refresh(ctx context.Context, token string) (auth.TokenPair, error)
	Logout(ctx context.Context, token string) error
	Authenticate(ctx context.Context, accessToken string) (auth.Principal, error)
}

// Entries is what the handlers need from *store.Store.
type Entries interface {
	ListEntries(ctx context.Context, ownerID string, after *store.Cursor, limit int) ([]store.Entry, error)
	GetEntry(ctx context.Context, ownerID, id string) (store.Entry, error)
	CreateBatch(ctx context.Context, ownerID string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error)
	UpdateEntry(ctx context.Context, ownerID, id string, p store.EntryPatch) (store.Entry, error)
	TrashEntry(ctx context.Context, ownerID, id string, now time.Time) error
	ListTrashed(ctx context.Context, ownerID string, after *store.Cursor, limit int) ([]store.TrashedEntry, error)
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
	DB      Pinger
	Logger  *slog.Logger
	Now     func() time.Time
}

const (
	authRateLimit  = 10
	authRateWindow = time.Minute
	pingTimeout    = 3 * time.Second
)

// NewRouter builds the API handler with all middleware applied.
func NewRouter(d Deps) http.Handler {
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	if d.Now == nil {
		d.Now = time.Now
	}

	mux := http.NewServeMux()
	// Production and the ALB health check use /health; /healthz is kept for
	// local use.
	health := healthz(d.DB)
	mux.Handle("GET /health", health)
	mux.Handle("GET /healthz", health)
	// The ALB health check uses /ping, which does not touch the database: a
	// DB check every few seconds would keep Neon from ever suspending, and a
	// database outage would make ECS replace healthy tasks.
	mux.Handle("GET /ping", ping())

	limiter := NewRateLimiter(authRateLimit, authRateWindow, d.Now)
	limited := func(h http.Handler) http.Handler { return rateLimit(limiter, h) }
	mux.Handle("POST /v1/auth/github", limited(loginGitHub(d.Auth)))
	mux.Handle("POST /v1/auth/password", limited(loginPassword(d.Auth)))
	mux.Handle("POST /v1/auth/refresh", limited(refresh(d.Auth)))
	mux.Handle("POST /v1/auth/logout", limited(logout(d.Auth)))

	authed := func(h http.Handler) http.Handler { return requireAuth(d.Auth, h) }
	mux.Handle("GET /v1/entries", authed(listEntries(d.Entries)))
	mux.Handle("GET /v1/entries/{id}", authed(getEntry(d.Entries)))
	mux.Handle("POST /v1/batches", authed(createBatch(d.Entries, d.Now)))
	mux.Handle("PATCH /v1/entries/{id}", authed(patchEntry(d.Entries)))
	mux.Handle("DELETE /v1/entries/{id}", authed(deleteEntry(d.Entries, d.Now)))
	mux.Handle("GET /v1/trash", authed(listTrash(d.Entries)))
	mux.Handle("DELETE /v1/trash", authed(emptyTrash(d.Entries)))
	mux.Handle("POST /v1/trash/{id}/restore", authed(restoreEntry(d.Entries)))
	mux.Handle("DELETE /v1/trash/{id}", authed(purgeEntry(d.Entries)))
	mux.Handle("PUT /v1/entries/{id}/share", authed(shareEntry(d.Entries, d.Now, true)))
	mux.Handle("DELETE /v1/entries/{id}/share", authed(shareEntry(d.Entries, d.Now, false)))
	mux.Handle("GET /v1/log-dates", authed(listLogDates(d.Entries)))
	mux.Handle("GET /v1/log-dates/{date}/entries", authed(listDailyEntries(d.Entries)))
	mux.Handle("GET /v1/log-dates/{date}/entries/{number}", authed(getDailyEntry(d.Entries)))
	mux.Handle("GET /v1/members", authed(listMembers(d.Follows)))
	mux.Handle("PUT /v1/follows/{ownerId}", authed(followMember(d.Follows, d.Now)))
	mux.Handle("DELETE /v1/follows/{ownerId}", authed(unfollowMember(d.Follows)))
	mux.Handle("GET /v1/timeline", authed(listTimeline(d.Follows)))

	return wrap(d, jsonMuxErrors(mux))
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
				writeError(w, http.StatusServiceUnavailable, "unavailable", msgUnavailable)
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
				writeError(w, http.StatusNotFound, "not_found", msgNotFound)
				return
			case http.StatusMethodNotAllowed:
				if allow := c.header.Get("Allow"); allow != "" {
					w.Header().Set("Allow", allow)
				}
				writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", msgMethodNotAllowed)
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
