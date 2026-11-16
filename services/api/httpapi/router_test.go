package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

// TestNoRouteAcceptsUserParam walks every registered route and checks that
// every authenticated route rejects ?user= with 400: the web reads other
// members' notes itself, so no Go route may look as if it honoured it.
func TestNoRouteAcceptsUserParam(t *testing.T) {
	a := &fakeAuth{authenticate: func(context.Context, string) (auth.Principal, error) {
		return auth.Principal{OwnerID: testOwner, Role: auth.RoleAdmin}, nil
	}}
	d := Deps{
		Auth:   a,
		Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
	mux, routes := newMux(d)
	h := wrap(d, jsonMuxErrors(mux))

	paths := strings.NewReplacer("{id}", "abc", "{ownerId}", "12345")
	for _, rt := range routes {
		if !rt.authed {
			continue
		}
		method, path, _ := strings.Cut(rt.pattern, " ")
		path = paths.Replace(path)

		// Every authed route requires a token.
		wantError(t, do(h, method, path, "", nil), http.StatusUnauthorized, "unauthorized")

		w := do(h, method, path+"?user="+otherOwner, "", authHeader)
		t.Run(rt.pattern, func(t *testing.T) {
			wantError(t, w, http.StatusBadRequest, "invalid_request")
		})
	}
}

// TestPublicRouteSetIsExactlyTheKnownRoutes pins the routes that are not
// behind requireAuth. Both the route table and real behaviour are checked: a
// request without a token must get 401 on every route except these, so a
// private route registered with public(...) by mistake fails here.
func TestPublicRouteSetIsExactlyTheKnownRoutes(t *testing.T) {
	d := Deps{
		Auth:   &fakeAuth{},
		Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
	mux, routes := newMux(d)
	h := wrap(d, jsonMuxErrors(mux))

	want := []string{
		"GET /health",
		"GET /healthz",
		"GET /ping",
		"POST /v1/auth/github",
		"POST /v1/auth/ffpf",
		"POST /v1/auth/password",
		"POST /v1/auth/refresh",
		"POST /v1/auth/logout",
		"POST /v1/auth/guest",
		"GET /v1/auth/demo",
		"POST /v1/auth/demo",
	}
	isPublic := map[string]bool{}
	for _, p := range want {
		isPublic[p] = true
	}

	paths := strings.NewReplacer("{id}", "abc", "{ownerId}", "12345")
	var got []string
	for _, rt := range routes {
		if !rt.authed {
			got = append(got, rt.pattern)
		}
		method, path, _ := strings.Cut(rt.pattern, " ")
		w := do(h, method, paths.Replace(path), "", nil)
		if isPublic[rt.pattern] {
			if w.Code == http.StatusUnauthorized {
				t.Errorf("%s: public route answered 401 without a token", rt.pattern)
			}
			continue
		}
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s: no token got %d, want 401 (route is not in the public set)", rt.pattern, w.Code)
		}
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("routes not behind requireAuth\n got: %q\nwant: %q", got, want)
	}
}

// TestRoutesRejectGuests sends a guest token to every authed route that does
// not allow guests and expects 403, and checks that GET /v1/me is the only
// route that does.
func TestRoutesRejectGuests(t *testing.T) {
	a := &fakeAuth{authenticate: func(context.Context, string) (auth.Principal, error) {
		return auth.Principal{OwnerID: auth.GuestOwnerID, Role: auth.RoleGuest}, nil
	}}
	d := Deps{
		Auth:   a,
		Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
	mux, routes := newMux(d)
	h := wrap(d, jsonMuxErrors(mux))

	paths := strings.NewReplacer("{id}", "abc", "{ownerId}", "12345")
	var got []string
	for _, rt := range routes {
		if rt.allowGuest {
			got = append(got, rt.pattern)
		}
		if !rt.authed || rt.allowGuest {
			continue
		}
		method, path, _ := strings.Cut(rt.pattern, " ")
		t.Run(rt.pattern, func(t *testing.T) {
			wantError(t, do(h, method, paths.Replace(path), "", authHeader), http.StatusForbidden, "forbidden")
		})
	}
	if want := []string{"GET /v1/me"}; strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("routes allowing guests\n got: %q\nwant: %q", got, want)
	}
}
