package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
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
	h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil)
	for _, target := range []string{"/health", "/healthz", "/nope"} {
		w := do(h, http.MethodGet, target, "", nil)
		if got := w.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control = %q, want no-store", target, got)
		}
	}
}

func TestNotFoundAndMethodNotAllowed(t *testing.T) {
	h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil)

	w := do(h, http.MethodGet, "/nope", "", nil)
	wantError(t, w, http.StatusNotFound, "not_found")

	for _, path := range healthPaths {
		w = do(h, http.MethodPost, path, "", nil)
		wantError(t, w, http.StatusMethodNotAllowed, "method_not_allowed")
		if allow := w.Header().Get("Allow"); !strings.Contains(allow, "GET") {
			t.Fatalf("%s: Allow = %q, want it to list GET", path, allow)
		}
	}

	w = do(h, http.MethodGet, "/v1/auth/password", "", nil)
	wantError(t, w, http.StatusMethodNotAllowed, "method_not_allowed")
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
				h, _ := testRouter(t, &fakeAuth{}, tc.db, nil)
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
	h, _ := testRouter(t, &fakeAuth{}, fakePinger{err: errors.New("down")}, nil)
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

func TestHealthzNotRateLimited(t *testing.T) {
	for _, path := range healthPaths {
		h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil)
		for i := range 50 {
			if w := do(h, http.MethodGet, path, "", nil); w.Code != http.StatusOK {
				t.Fatalf("%s request %d: status = %d", path, i+1, w.Code)
			}
		}
	}
}

func TestRateLimiter(t *testing.T) {
	c := newClock()
	rl := NewRateLimiter(10, time.Minute, c.Now)

	for i := range 10 {
		if !rl.Allow("a") {
			t.Fatalf("request %d for a was rejected", i+1)
		}
	}
	if rl.Allow("a") {
		t.Fatal("11th request for a was allowed")
	}
	if !rl.Allow("b") {
		t.Fatal("key b should be independent of key a")
	}

	c.Advance(61 * time.Second)
	if !rl.Allow("a") {
		t.Fatal("a should be allowed again after the window")
	}
}

func TestRateLimiterEvictsStaleKeys(t *testing.T) {
	c := newClock()
	rl := NewRateLimiter(10, time.Minute, c.Now)
	for i := range 100 {
		rl.Allow(fmt.Sprintf("key-%d", i))
	}
	c.Advance(2 * time.Minute)
	rl.Allow("fresh")

	rl.mu.Lock()
	defer rl.mu.Unlock()
	if len(rl.buckets) != 1 {
		t.Fatalf("%d buckets after the window, want only the fresh key", len(rl.buckets))
	}
}

func TestClientKey(t *testing.T) {
	cases := []struct {
		name, remote, xff, want string
	}{
		{"trailing comma falls back", "192.0.2.7:5555", "1.1.1.1,", "192.0.2.7"},
		{"trailing whitespace", "10.0.0.1:1", "1.1.1.1, 203.0.113.9   ", "203.0.113.9"},
		{"remote addr host", "192.0.2.7:5555", "", "192.0.2.7"},
		{"remote addr without port", "192.0.2.7", "", "192.0.2.7"},
		{"ipv6 remote", "[2001:db8::1]:80", "", "2001:db8::1"},
		{"xff single", "10.0.0.1:1", "203.0.113.9", "203.0.113.9"},
		{"xff last wins", "10.0.0.1:1", "1.1.1.1, 2.2.2.2 ,  203.0.113.9 ", "203.0.113.9"},
		{"empty xff falls back", "192.0.2.7:5555", "  ", "192.0.2.7"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = tc.remote
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if got := clientKey(r); got != tc.want {
				t.Fatalf("clientKey = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestClientKeyMultipleXFFLines(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "192.0.2.7:5555"
	r.Header.Add("X-Forwarded-For", "6.6.6.6")
	r.Header.Add("X-Forwarded-For", "1.1.1.1, 203.0.113.9")
	if got := clientKey(r); got != "203.0.113.9" {
		t.Fatalf("clientKey = %q, want the last value of the last line", got)
	}

	r = httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "192.0.2.7:5555"
	r.Header.Add("X-Forwarded-For", "6.6.6.6")
	r.Header.Add("X-Forwarded-For", "")
	if got := clientKey(r); got != "192.0.2.7" {
		t.Fatalf("clientKey = %q, want RemoteAddr host when the last line is empty", got)
	}
}

func TestAuthRateLimitIgnoresClientControlledXFFLines(t *testing.T) {
	a := &fakeAuth{password: func(context.Context, string, string) (auth.TokenPair, error) {
		return auth.TokenPair{}, auth.ErrUnauthorized
	}}
	h, _ := testRouter(t, a, fakePinger{}, nil)
	body := `{"loginId":"someone","password":"pw"}`
	for i := range 11 {
		r := httptest.NewRequest(http.MethodPost, "/v1/auth/password", strings.NewReader(body))
		r.Header.Add("X-Forwarded-For", fmt.Sprintf("10.9.9.%d", i)) // client-chosen line
		r.Header.Add("X-Forwarded-For", "203.0.113.77")              // proxy-appended line
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if i < 10 && w.Code != http.StatusUnauthorized {
			t.Fatalf("request %d: status = %d, want 401", i+1, w.Code)
		}
		if i == 10 {
			wantError(t, w, http.StatusTooManyRequests, "rate_limited")
		}
	}
}

func TestAuthRoutesRateLimited(t *testing.T) {
	a := &fakeAuth{password: func(_ context.Context, _, _ string) (auth.TokenPair, error) {
		return auth.TokenPair{}, auth.ErrUnauthorized
	}}
	h, _ := testRouter(t, a, fakePinger{}, nil)
	body := `{"loginId":"someone","password":"pw"}`

	for i := range 10 {
		w := do(h, http.MethodPost, "/v1/auth/password", body, nil)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("request %d: status = %d, want 401", i+1, w.Code)
		}
	}
	w := do(h, http.MethodPost, "/v1/auth/password", body, nil)
	wantError(t, w, http.StatusTooManyRequests, "rate_limited")

	// The limit is shared by every /v1/auth/* route for the same client...
	w = do(h, http.MethodPost, "/v1/auth/logout", `{"refreshToken":"x"}`, nil)
	wantError(t, w, http.StatusTooManyRequests, "rate_limited")

	// ...but another client is unaffected.
	w = do(h, http.MethodPost, "/v1/auth/password", body, map[string]string{"X-Forwarded-For": "203.0.113.50"})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("other client: status = %d, want 401", w.Code)
	}
}

func TestBearer(t *testing.T) {
	want := auth.Principal{OwnerID: "42", Role: auth.RoleAdmin, Login: "octo"}

	cases := []struct {
		name       string
		header     string // empty means no header
		authErr    error
		wantStatus int
		wantCode   string
		wantToken  string // token Authenticate must receive; empty means not called
	}{
		{"no header", "", nil, 401, "unauthorized", ""},
		{"basic scheme", "Basic dXNlcjpwdw==", nil, 401, "unauthorized", ""},
		{"bearer without token", "Bearer", nil, 401, "unauthorized", ""},
		{"bearer empty token", "Bearer ", nil, 401, "unauthorized", ""},
		{"two spaces", "Bearer  tok", nil, 401, "unauthorized", ""},
		{"token with space", "Bearer a b", nil, 401, "unauthorized", ""},
		{"unauthorized", "Bearer tok", auth.ErrUnauthorized, 401, "unauthorized", "tok"},
		{"forbidden", "Bearer tok", auth.ErrForbidden, 403, "forbidden", "tok"},
		{"wrapped forbidden", "Bearer tok", fmt.Errorf("x: %w", auth.ErrForbidden), 403, "forbidden", "tok"},
		{"store failure", "Bearer tok", errors.New("db down"), 500, "internal", "tok"},
		{"ok", "Bearer tok", nil, 200, "", "tok"},
		{"scheme is case-insensitive", "bEaReR tok", nil, 200, "", "tok"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var gotToken string
			a := &fakeAuth{authenticate: func(_ context.Context, token string) (auth.Principal, error) {
				gotToken = token
				if tc.authErr != nil {
					return auth.Principal{}, tc.authErr
				}
				return want, nil
			}}
			var gotPrincipal auth.Principal
			var reached bool
			mux := http.NewServeMux()
			mux.Handle("GET /secret", requireAuth(a, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				gotPrincipal = principalFrom(r.Context())
				w.WriteHeader(http.StatusOK)
			})))
			d := Deps{Auth: a, Logger: slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil)), Now: newClock().Now}
			h := wrap(d, mux)

			headers := map[string]string{}
			if tc.header != "" {
				headers["Authorization"] = tc.header
			}
			w := do(h, http.MethodGet, "/secret", "", headers)

			if tc.wantStatus == http.StatusOK {
				if w.Code != http.StatusOK || !reached {
					t.Fatalf("status = %d reached = %v, want 200 and reached", w.Code, reached)
				}
				if gotPrincipal != want {
					t.Fatalf("principal = %+v, want %+v", gotPrincipal, want)
				}
			} else {
				wantError(t, w, tc.wantStatus, tc.wantCode)
				if reached {
					t.Fatal("handler ran despite failed authentication")
				}
			}
			if gotToken != tc.wantToken {
				t.Fatalf("Authenticate token = %q, want %q", gotToken, tc.wantToken)
			}
		})
	}
}

func TestPrincipalFromEmptyContext(t *testing.T) {
	if p := principalFrom(httptest.NewRequest(http.MethodGet, "/", nil).Context()); p != (auth.Principal{}) {
		t.Fatalf("principal = %+v, want zero", p)
	}
}

func TestAccessLogFields(t *testing.T) {
	h, buf := testRouter(t, &fakeAuth{}, fakePinger{}, nil)
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
