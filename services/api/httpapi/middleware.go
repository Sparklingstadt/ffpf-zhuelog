package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

const maxBodyBytes = 1 << 20

type ctxKey int

const loggerKey ctxKey = iota

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
			writeError(w, http.StatusInternalServerError, codeInternal, msgInternal)
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

// limitBody caps request bodies at 1 MiB.
func limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		next.ServeHTTP(w, r)
	})
}
