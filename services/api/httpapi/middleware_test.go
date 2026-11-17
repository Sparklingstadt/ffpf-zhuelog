package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

func TestRecoverReturns500(t *testing.T) {
	buf := &bytes.Buffer{}
	d := Deps{Logger: slog.New(slog.NewJSONHandler(buf, nil)), Now: newClock().Now}
	h := wrap(d, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom-value")
	}))

	w := do(h, http.MethodGet, "/x", "", nil)

	wantError(t, w, http.StatusInternalServerError, "internal")
	if !strings.Contains(buf.String(), "boom-value") {
		t.Fatalf("log does not contain the panic value: %s", buf.String())
	}
	// The access log still records the request, as a 500.
	var sawAccess bool
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("log line is not JSON: %q", line)
		}
		if rec["msg"] == "request" {
			sawAccess = true
			if rec["status"] != float64(500) {
				t.Fatalf("access log status = %v, want 500", rec["status"])
			}
		}
	}
	if !sawAccess {
		t.Fatalf("no access log for the panicking request: %s", buf.String())
	}
}

func TestRecoverAfterHeadersSentKeepsResponse(t *testing.T) {
	buf := &bytes.Buffer{}
	d := Deps{Logger: slog.New(slog.NewJSONHandler(buf, nil)), Now: newClock().Now}
	h := wrap(d, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("partial"))
		panic("late-boom")
	}))

	w := do(h, http.MethodGet, "/x", "", nil)

	if w.Code != http.StatusAccepted || w.Body.String() != "partial" {
		t.Fatalf("response = %d %q, want the already-sent 202 \"partial\" untouched", w.Code, w.Body.String())
	}
	if !strings.Contains(buf.String(), "late-boom") {
		t.Fatalf("panic not logged: %s", buf.String())
	}
}

func TestRecoverRepanicsAbortHandler(t *testing.T) {
	d := Deps{Logger: slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil)), Now: newClock().Now}
	h := wrap(d, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))
	defer func() {
		if recover() != http.ErrAbortHandler {
			t.Fatal("http.ErrAbortHandler was not re-panicked")
		}
	}()
	do(h, http.MethodGet, "/x", "", nil)
}

func TestNoStoreHeader(t *testing.T) {
	h, _ := testRouter(t, fakePinger{}, nil)
	for _, target := range []string{"/health", "/healthz", "/nope"} {
		w := do(h, http.MethodGet, target, "", nil)
		if got := w.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control = %q, want no-store", target, got)
		}
	}
}

func TestNotFoundAndMethodNotAllowed(t *testing.T) {
	h, _ := testRouter(t, fakePinger{}, nil)

	w := do(h, http.MethodGet, "/nope", "", nil)
	wantError(t, w, http.StatusNotFound, "not_found")

	for _, path := range healthPaths {
		w = do(h, http.MethodPost, path, "", nil)
		wantError(t, w, http.StatusMethodNotAllowed, "method_not_allowed")
		if allow := w.Header().Get("Allow"); !strings.Contains(allow, "GET") {
			t.Fatalf("%s: Allow = %q, want it to list GET", path, allow)
		}
	}
}

// healthPaths are the health-check routes: /health for production and the
// ALB, /healthz for local use.
var healthPaths = []string{"/health", "/healthz"}

func TestHealthz(t *testing.T) {
	cases := []struct {
		name string
		db   Pinger
		want int
	}{
		{"ok", fakePinger{}, http.StatusOK},
		{"db down", fakePinger{err: errors.New("down")}, http.StatusServiceUnavailable},
	}
	for _, path := range healthPaths {
		for _, tc := range cases {
			t.Run(path+" "+tc.name, func(t *testing.T) {
				h, _ := testRouter(t, tc.db, nil)
				// No Authorization header: health checks are unauthenticated.
				w := do(h, http.MethodGet, path, "", nil)
				if w.Code != tc.want {
					t.Fatalf("status = %d, want %d", w.Code, tc.want)
				}
				if tc.want != http.StatusOK {
					wantError(t, w, tc.want, "unavailable")
				}
			})
		}
	}
}

// /ping answers without touching the database, so the ALB health check
// neither keeps Neon awake nor replaces tasks during a database outage.
func TestPingDoesNotTouchDatabase(t *testing.T) {
	h, _ := testRouter(t, fakePinger{err: errors.New("down")}, nil)
	for i := range 50 {
		w := do(h, http.MethodGet, "/ping", "", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want 200", i+1, w.Code)
		}
	}
	if w := do(h, http.MethodPost, "/ping", "", nil); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /ping status = %d, want 405", w.Code)
	}
}

func TestAccessLogFields(t *testing.T) {
	h, buf := testRouter(t, fakePinger{}, nil)
	do(h, http.MethodGet, "/healthz?token=abc&x=1", "", map[string]string{"Authorization": "Bearer sekrit"})

	var rec map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &rec); err != nil {
		t.Fatalf("log is not a single JSON line: %q", buf.String())
	}
	if rec["method"] != "GET" || rec["path"] != "/healthz" || rec["status"] != float64(200) {
		t.Fatalf("unexpected access log: %v", rec)
	}
	if _, ok := rec["duration_ms"]; !ok {
		t.Fatalf("access log has no duration_ms: %v", rec)
	}
	for _, leaked := range []string{"abc", "sekrit", "token"} {
		if strings.Contains(buf.String(), leaked) {
			t.Fatalf("access log leaks %q: %s", leaked, buf.String())
		}
	}
}
