package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

type fakeDemoReset struct {
	calls int
	now   time.Time
	err   error
}

func (f *fakeDemoReset) Reset(_ context.Context, now time.Time) error {
	f.calls++
	f.now = now
	return f.err
}

// demoAuth authenticates "tok" as testOwner, a member who is the demo account
// when demo is set.
func demoAuth(demo bool) *fakeAuth {
	a := tokenAuth(auth.RoleMember)
	a.demoEnabled = true
	a.isDemo = func(_ context.Context, p auth.Principal) (bool, error) {
		return demo && p.OwnerID == testOwner && p.ActorID == "", nil
	}
	return a
}

// allRoutesDeps registers every route, the demo's included.
func allRoutesDeps(a Auth) Deps {
	return Deps{
		Auth: a,
		Line: &fakeLine{}, LineChannelSecret: testLineSecret, CronSecret: testCronSecret, DemoReset: &fakeDemoReset{},
		Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
}

// TestDemoIsRefusedExactlyTheClosedRoutes pins the routes closed to the demo
// account and checks that the demo gets 403 there and nowhere else, and that
// a normal member is never refused as the demo.
func TestDemoIsRefusedExactlyTheClosedRoutes(t *testing.T) {
	want := []string{
		"GET /v1/line/link",
		"POST /v1/line/link-code",
		"DELETE /v1/line/link",
		"PUT /v1/line/review-notify",
		"DELETE /v1/line/review-notify",
	}
	paths := strings.NewReplacer("{id}", "abc", "{itemId}", "abc", "{ownerId}", otherOwner)

	for _, demo := range []bool{true, false} {
		d := allRoutesDeps(demoAuth(demo))
		mux, routes := newMux(d)
		h := wrap(d, jsonMuxErrors(mux))
		var closed []string
		for _, rt := range routes {
			if rt.closedToDemo {
				closed = append(closed, rt.pattern)
			}
			if !rt.authed {
				continue
			}
			method, path, _ := strings.Cut(rt.pattern, " ")
			w := do(h, method, paths.Replace(path), "{}", jsonAuth)
			refused := w.Code == http.StatusForbidden && decodeError(t, w).Error.Message == msgDemoRestricted
			if wantRefused := demo && rt.closedToDemo; refused != wantRefused {
				t.Errorf("demo=%v %s: refused as the demo = %v, want %v (status %d)", demo, rt.pattern, refused, wantRefused, w.Code)
			}
		}
		sort.Strings(closed)
		sorted := append([]string(nil), want...)
		sort.Strings(sorted)
		if strings.Join(closed, "\n") != strings.Join(sorted, "\n") {
			t.Errorf("routes closed to the demo\n got: %q\nwant: %q", closed, sorted)
		}
	}
}

func TestDemoCheckErrorIsNotAPass(t *testing.T) {
	a := tokenAuth(auth.RoleMember)
	a.isDemo = func(context.Context, auth.Principal) (bool, error) { return false, errors.New("db down") }
	h, _, _ := routerWith(t, auth.RoleMember, Deps{Auth: a, Line: &fakeLine{}, LineChannelSecret: testLineSecret, CronSecret: testCronSecret})
	wantError(t, do(h, http.MethodGet, "/v1/line/link", "", authHeader), http.StatusInternalServerError, "internal")
}

func TestDemoStatus(t *testing.T) {
	h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil)
	wantError(t, do(h, http.MethodGet, "/v1/auth/demo", "", nil), http.StatusNotFound, "not_found")

	h, _ = testRouter(t, &fakeAuth{demoEnabled: true}, fakePinger{}, nil)
	if w := do(h, http.MethodGet, "/v1/auth/demo", "", nil); w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
}

func TestDemoLogin(t *testing.T) {
	var gotClient string
	a := &fakeAuth{loginDemo: func(_ context.Context, client string) (auth.TokenPair, error) {
		gotClient = client
		return testPair, nil
	}}
	for _, body := range []string{"", `{}`} {
		h, _ := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, "/v1/auth/demo", body, map[string]string{"X-Forwarded-For": "198.51.100.7"})
		if w.Code != http.StatusOK {
			t.Fatalf("body %q: status = %d, body %q", body, w.Code, w.Body.String())
		}
		wantPair(t, w.Body.Bytes())
		if gotClient != "198.51.100.7" {
			t.Fatalf("client = %q", gotClient)
		}
	}
	h, _ := testRouter(t, a, fakePinger{}, nil)
	wantError(t, do(h, http.MethodPost, "/v1/auth/demo", `{"loginId":"demo"}`, nil), http.StatusBadRequest, "invalid_request")

	t.Run("off", func(t *testing.T) {
		a := &fakeAuth{loginDemo: func(context.Context, string) (auth.TokenPair, error) {
			return auth.TokenPair{}, auth.ErrDemoDisabled
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, "/v1/auth/demo", "", nil)
		wantError(t, w, http.StatusNotFound, "not_found")
		if msg := decodeError(t, w).Error.Message; msg != msgDemoDisabled {
			t.Fatalf("message = %q", msg)
		}
	})

	t.Run("throttled", func(t *testing.T) {
		a := &fakeAuth{loginDemo: func(context.Context, string) (auth.TokenPair, error) {
			return auth.TokenPair{}, auth.ErrThrottled
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/demo", "", nil), http.StatusTooManyRequests, "rate_limited")
	})

	t.Run("web only with a proxy secret", func(t *testing.T) {
		secret := []byte(strings.Repeat("p", 32))
		h := NewRouter(Deps{Auth: a, WebProxySecret: secret, Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil))})
		wantError(t, do(h, http.MethodPost, "/v1/auth/demo", "", nil), http.StatusForbidden, "forbidden")
		w := do(h, http.MethodPost, "/v1/auth/demo", "", map[string]string{
			"X-Zhuelog-Proxy-Secret": string(secret), "X-Zhuelog-Client-IP": "203.0.113.5",
		})
		if w.Code != http.StatusOK || gotClient != "203.0.113.5" {
			t.Fatalf("status = %d, client %q", w.Code, gotClient)
		}
	})
}

func TestDemoResetNeedsTheCronSecret(t *testing.T) {
	reset := &fakeDemoReset{}
	h, clk, _ := routerWith(t, auth.RoleMember, Deps{DemoReset: reset, CronSecret: testCronSecret})
	bearer := map[string]string{"Authorization": "Bearer " + string(testCronSecret)}

	for _, headers := range []map[string]string{nil, {"Authorization": "Bearer wrong"}, authHeader} {
		wantError(t, do(h, http.MethodPost, demoResetPath, "", headers), http.StatusUnauthorized, "unauthorized")
	}
	if reset.calls != 0 {
		t.Fatal("reset ran without the cron secret")
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		if w := do(h, method, demoResetPath, "", bearer); w.Code != http.StatusNoContent {
			t.Fatalf("%s: status = %d, body %q", method, w.Code, w.Body.String())
		}
	}
	if reset.calls != 2 || !reset.now.Equal(clk.Now()) {
		t.Fatalf("calls = %d, now = %v", reset.calls, reset.now)
	}

	reset.err = errors.New("db down")
	wantError(t, do(h, http.MethodGet, demoResetPath, "", bearer), http.StatusInternalServerError, "internal")

	// Without a cron secret nobody may reset.
	h, _, _ = routerWith(t, auth.RoleMember, Deps{DemoReset: reset})
	wantError(t, do(h, http.MethodGet, demoResetPath, "", map[string]string{"Authorization": "Bearer "}), http.StatusUnauthorized, "unauthorized")

	// Without a demo the route does not exist.
	h, _, _ = routerWith(t, auth.RoleMember, Deps{CronSecret: testCronSecret})
	wantError(t, do(h, http.MethodGet, demoResetPath, "", bearer), http.StatusNotFound, "not_found")
}
