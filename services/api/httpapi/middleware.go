package httpapi

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

const maxBodyBytes = 1 << 20

type ctxKey int

const (
	principalKey ctxKey = iota
	loggerKey
)

// principalFrom returns the authenticated caller stored by requireAuth, or the
// zero Principal when the request did not pass through it.
func principalFrom(ctx context.Context) auth.Principal {
	p, _ := ctx.Value(principalKey).(auth.Principal)
	return p
}

// loggerFrom returns the request logger installed by accessLog.
func loggerFrom(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// wrap applies the middleware stack, outermost first: recover, access log,
// no-store, body size limit.
func wrap(d Deps, next http.Handler) http.Handler {
	next = limitBody(next)
	next = noStore(next)
	next = accessLog(d.Logger, d.Now, next)
	return recoverer(d.Logger, next)
}

func recoverer(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w := &statusWriter{ResponseWriter: rw, status: http.StatusOK}
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			if v == http.ErrAbortHandler {
				panic(v)
			}
			logger.Error("panic recovered", "panic", v, "stack", string(debug.Stack()))
			if w.wrote {
				return // the response is already on the wire; a second status would be wrong
			}
			writeError(w, http.StatusInternalServerError, "internal", msgInternal)
		}()
		next.ServeHTTP(w, r)
	})
}

// statusWriter records the status code sent to the client.
type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	if !w.wrote {
		w.status, w.wrote = code, true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.status, w.wrote = http.StatusOK, true
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// accessLog logs method, path (never the query), status and duration, and
// makes logger available to handlers through the request context. It never
// logs bodies or headers.
func accessLog(logger *slog.Logger, now func() time.Time, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		completed := false
		defer func() {
			status := sw.status
			if !completed && !sw.wrote { // a panic is unwinding; recoverer answers 500
				status = http.StatusInternalServerError
			}
			logger.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", status,
				"duration_ms", now().Sub(start).Milliseconds(),
			)
		}()
		ctx := context.WithValue(r.Context(), loggerKey, logger)
		next.ServeHTTP(sw, r.WithContext(ctx))
		completed = true
	})
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		next.ServeHTTP(w, r)
	})
}

// requireAuth answers 401/403 unless the request carries a valid
// "Authorization: Bearer <token>" header; otherwise it stores the Principal in
// the request context for next.
func requireAuth(a Auth, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" || strings.Contains(token, " ") {
			writeError(w, http.StatusUnauthorized, "unauthorized", msgUnauthorized)
			return
		}
		p, err := a.Authenticate(r.Context(), token)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey, p)))
	})
}

// RateLimiter is a fixed-window limiter keyed by an arbitrary string.
type RateLimiter struct {
	mu        sync.Mutex
	limit     int
	window    time.Duration
	now       func() time.Time
	buckets   map[string]*bucket
	lastSweep time.Time
}

type bucket struct {
	start time.Time
	count int
}

// NewRateLimiter allows limit calls per key in each window. A nil now means
// time.Now.
func NewRateLimiter(limit int, window time.Duration, now func() time.Time) *RateLimiter {
	if now == nil {
		now = time.Now
	}
	return &RateLimiter{limit: limit, window: window, now: now, buckets: map[string]*bucket{}}
}

// Allow reports whether key may proceed, counting the call if so. Expired
// windows are dropped at most once per window, so memory stays bounded by the
// keys seen within about two windows.
func (r *RateLimiter) Allow(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	t := r.now()
	if t.Sub(r.lastSweep) >= r.window {
		for k, b := range r.buckets {
			if t.Sub(b.start) >= r.window {
				delete(r.buckets, k)
			}
		}
		r.lastSweep = t
	}

	b := r.buckets[key]
	if b == nil || t.Sub(b.start) >= r.window {
		r.buckets[key] = &bucket{start: t, count: 1}
		return true
	}
	if b.count >= r.limit {
		return false
	}
	b.count++
	return true
}

// clientKey identifies the caller for rate limiting and sign-in throttling: the
// last value of X-Forwarded-For (the one our own proxy appended) if present,
// otherwise the host part of RemoteAddr.
func clientKey(r *http.Request) string {
	// A client can send several X-Forwarded-For lines; only the last value of
	// the last line was appended by our own proxy.
	if vals := r.Header.Values("X-Forwarded-For"); len(vals) > 0 {
		last := vals[len(vals)-1]
		if i := strings.LastIndexByte(last, ','); i >= 0 {
			last = last[i+1:]
		}
		if last = strings.TrimSpace(last); last != "" {
			return last
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func rateLimit(rl *RateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.Allow(clientKey(r)) {
			writeError(w, http.StatusTooManyRequests, "rate_limited", msgRateLimited)
			return
		}
		next.ServeHTTP(w, r)
	})
}
