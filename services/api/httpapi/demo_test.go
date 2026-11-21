package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

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
