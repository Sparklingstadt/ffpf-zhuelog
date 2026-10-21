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

// TestOnlyReadRoutesAcceptUserParam walks every registered route and checks
// that ?user= is honoured by exactly the five read routes and rejected with
// 400 by every other authenticated route.
func TestOnlyReadRoutesAcceptUserParam(t *testing.T) {
	a := &fakeAuth{authenticate: func(context.Context, string) (auth.Principal, error) {
		return auth.Principal{OwnerID: testOwner, Role: auth.RoleAdmin}, nil
	}}
	d := Deps{
		Auth: a, Entries: &fakeEntries{}, Follows: &fakeFollows{},
		Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
	mux, routes := newMux(d)
	h := wrap(d, jsonMuxErrors(mux))

	want := []string{
		"GET /v1/entries",
		"GET /v1/entries/{id}",
		"GET /v1/log-dates",
		"GET /v1/log-dates/{date}/entries",
		"GET /v1/log-dates/{date}/entries/{number}",
	}
	var got []string
	paths := strings.NewReplacer("{id}", "abc", "{ownerId}", "12345", "{date}", "2026-01-01", "{number}", "1")
	for _, rt := range routes {
		if rt.allowUser {
			got = append(got, rt.pattern)
		}
		if !rt.authed {
			continue
		}
		method, path, _ := strings.Cut(rt.pattern, " ")
		path = paths.Replace(path)

		// Every authed route requires a token.
		wantError(t, do(h, method, path, "", nil), http.StatusUnauthorized, "unauthorized")

		w := do(h, method, path+"?user="+otherOwner, "", authHeader)
		if rt.allowUser {
			if w.Code == http.StatusBadRequest {
				t.Errorf("%s: ?user= rejected on a read route (body %q)", rt.pattern, w.Body.String())
			}
			continue
		}
		t.Run(rt.pattern, func(t *testing.T) {
			wantError(t, w, http.StatusBadRequest, "invalid_request")
		})
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("routes accepting ?user=\n got: %q\nwant: %q", got, want)
	}
}

// TestPublicRouteSetIsExactlyTheSevenKnownRoutes pins the routes that are not
// behind requireAuth. Both the route table and real behaviour are checked: a
// request without a token must get 401 on every route except these seven, so
// a private route registered with public(...) by mistake fails here.
func TestPublicRouteSetIsExactlyTheSevenKnownRoutes(t *testing.T) {
	d := Deps{
		Auth: &fakeAuth{}, Entries: &fakeEntries{}, Follows: &fakeFollows{},
		Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
	mux, routes := newMux(d)
	h := wrap(d, jsonMuxErrors(mux))

	want := []string{
		"GET /health",
		"GET /healthz",
		"GET /ping",
		"POST /v1/auth/github",
		"POST /v1/auth/password",
		"POST /v1/auth/refresh",
		"POST /v1/auth/logout",
	}
	isPublic := map[string]bool{}
	for _, p := range want {
		isPublic[p] = true
	}

	paths := strings.NewReplacer("{id}", "abc", "{ownerId}", "12345", "{date}", "2026-01-01", "{number}", "1")
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
