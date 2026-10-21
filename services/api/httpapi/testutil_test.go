package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

// fakeAuth implements Auth with per-method hooks; an unset hook fails the test
// by returning a sentinel error that maps to 500.
type fakeAuth struct {
	github       func(ctx context.Context, code, verifier, redirectURI string) (auth.TokenPair, error)
	password     func(ctx context.Context, client, loginID, password string) (auth.TokenPair, error)
	refresh      func(ctx context.Context, token string) (auth.TokenPair, error)
	logout       func(ctx context.Context, token string) error
	authenticate func(ctx context.Context, accessToken string) (auth.Principal, error)
	changePass   func(ctx context.Context, p auth.Principal, current, next, confirm string) error
}

type errUnexpectedCall struct{ name string }

func (e errUnexpectedCall) Error() string { return "unexpected call to " + e.name }

func (f *fakeAuth) LoginGitHub(ctx context.Context, code, verifier, redirectURI string) (auth.TokenPair, error) {
	if f.github == nil {
		return auth.TokenPair{}, errUnexpectedCall{"LoginGitHub"}
	}
	return f.github(ctx, code, verifier, redirectURI)
}

func (f *fakeAuth) LoginPassword(ctx context.Context, client, loginID, password string) (auth.TokenPair, error) {
	if f.password == nil {
		return auth.TokenPair{}, errUnexpectedCall{"LoginPassword"}
	}
	return f.password(ctx, client, loginID, password)
}

func (f *fakeAuth) Refresh(ctx context.Context, token string) (auth.TokenPair, error) {
	if f.refresh == nil {
		return auth.TokenPair{}, errUnexpectedCall{"Refresh"}
	}
	return f.refresh(ctx, token)
}

func (f *fakeAuth) Logout(ctx context.Context, token string) error {
	if f.logout == nil {
		return errUnexpectedCall{"Logout"}
	}
	return f.logout(ctx, token)
}

func (f *fakeAuth) Authenticate(ctx context.Context, accessToken string) (auth.Principal, error) {
	if f.authenticate == nil {
		return auth.Principal{}, errUnexpectedCall{"Authenticate"}
	}
	return f.authenticate(ctx, accessToken)
}

func (f *fakeAuth) ChangePassword(ctx context.Context, p auth.Principal, current, next, confirm string) error {
	if f.changePass == nil {
		return errUnexpectedCall{"ChangePassword"}
	}
	return f.changePass(ctx, p, current, next, confirm)
}

type fakePinger struct{ err error }

func (p fakePinger) Ping(context.Context) error { return p.err }

// clock is a settable time source.
type clock struct{ t time.Time }

func newClock() *clock { return &clock{t: time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)} }

func (c *clock) Now() time.Time          { return c.t }
func (c *clock) Advance(d time.Duration) { c.t = c.t.Add(d) }

// testRouter builds the full router with a JSON logger writing to the
// returned buffer.
func testRouter(t *testing.T, a Auth, db Pinger, c *clock) (http.Handler, *bytes.Buffer) {
	t.Helper()
	buf := &bytes.Buffer{}
	if c == nil {
		c = newClock()
	}
	h := NewRouter(Deps{
		Auth:   a,
		DB:     db,
		Logger: slog.New(slog.NewJSONHandler(buf, nil)),
		Now:    c.Now,
	})
	return h, buf
}

// tokenAuth authenticates the test token "tok" as testOwner with the given
// role (use "" for no role) and rejects every other token.
func tokenAuth(role string) *fakeAuth {
	return &fakeAuth{authenticate: func(_ context.Context, tok string) (auth.Principal, error) {
		if tok != "tok" {
			return auth.Principal{}, auth.ErrUnauthorized
		}
		return auth.Principal{OwnerID: testOwner, Role: role}, nil
	}}
}

// routerWith builds the full router around d. Unset Auth defaults to
// tokenAuth(role); Logger writes JSON to the returned buffer and Now follows
// the returned clock, unless d sets them.
func routerWith(t *testing.T, role string, d Deps) (http.Handler, *clock, *bytes.Buffer) {
	t.Helper()
	buf := &bytes.Buffer{}
	c := newClock()
	if d.Auth == nil {
		d.Auth = tokenAuth(role)
	}
	if d.Logger == nil {
		d.Logger = slog.New(slog.NewJSONHandler(buf, nil))
	}
	if d.Now == nil {
		d.Now = c.Now
	}
	return NewRouter(d), c, buf
}

func do(h http.Handler, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, target, nil)
	} else {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

type errorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func decodeError(t *testing.T, w *httptest.ResponseRecorder) errorResponse {
	t.Helper()
	var e errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
		t.Fatalf("response is not an error body: %q (%v)", w.Body.String(), err)
	}
	return e
}

func wantError(t *testing.T, w *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status = %d, want %d (body %q)", w.Code, status, w.Body.String())
	}
	e := decodeError(t, w)
	if e.Error.Code != code {
		t.Fatalf("code = %q, want %q", e.Error.Code, code)
	}
	if e.Error.Message == "" {
		t.Fatal("error message is empty")
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}
