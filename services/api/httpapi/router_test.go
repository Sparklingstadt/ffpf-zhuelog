package httpapi

import (
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"testing"
)

// TestPublicRouteSetIsExactlyTheKnownRoutes pins every registered route:
// since stage 11 of the Go retirement only the health routes are left, and
// each answers without a token.
func TestPublicRouteSetIsExactlyTheKnownRoutes(t *testing.T) {
	d := Deps{
		DB:     fakePinger{},
		Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
	mux, routes := newMux(d)
	h := wrap(d, jsonMuxErrors(mux))

	want := []string{
		"GET /health",
		"GET /healthz",
		"GET /ping",
	}

	var got []string
	for _, rt := range routes {
		got = append(got, rt.pattern)
		method, path, _ := strings.Cut(rt.pattern, " ")
		if w := do(h, method, path, "", nil); w.Code != http.StatusOK {
			t.Errorf("%s: no token got %d, want 200", rt.pattern, w.Code)
		}
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("registered routes\n got: %q\nwant: %q", got, want)
	}
}

// TestRetiredSignInRoutesAre404 checks that the sign-in routes moved to the
// web in stage 11 are gone from Go.
func TestRetiredSignInRoutesAre404(t *testing.T) {
	h, _ := testRouter(t, fakePinger{}, nil)
	for _, rt := range []struct{ method, path string }{
		{http.MethodPost, "/v1/auth/password"},
		{http.MethodPost, "/v1/auth/refresh"},
		{http.MethodGet, "/v1/auth/demo"},
		{http.MethodGet, "/v1/me"},
	} {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			wantError(t, do(h, rt.method, rt.path, "", map[string]string{"Authorization": "Bearer tok"}), http.StatusNotFound, "not_found")
		})
	}
}
