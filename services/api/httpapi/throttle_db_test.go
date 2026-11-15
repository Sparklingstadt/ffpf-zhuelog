package httpapi

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// Two router instances (two serverless instances) on one database share one
// sign-in limit: 10 attempts in all, not 10 each.
func TestRouteRateLimitSharedAcrossInstances(t *testing.T) {
	url := os.Getenv("API_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("API_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	s, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(s.Close)

	// A client IP of its own, so runs never share a counter.
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	ip := fmt.Sprintf("2001:db8::%x:%x", b[0], b[1])
	t.Cleanup(func() {
		if conn, err := pgx.Connect(context.Background(), url); err == nil {
			_, _ = conn.Exec(context.Background(), `DELETE FROM "SignInThrottle" WHERE "key" IN ($1, $2)`,
				"route:auth:"+ip, "route:refresh:"+ip)
			_ = conn.Close(context.Background())
		}
	})

	a := &fakeAuth{
		password: func(context.Context, string, string, string) (auth.TokenPair, error) {
			return auth.TokenPair{}, auth.ErrUnauthorized
		},
		refresh: func(context.Context, string) (auth.TokenPair, error) { return auth.TokenPair{}, auth.ErrUnauthorized },
	}
	newInstance := func() http.Handler {
		return NewRouter(Deps{Auth: a, DB: fakePinger{}, Throttle: s, Logger: slog.New(slog.NewJSONHandler(io.Discard, nil)), Now: time.Now})
	}
	first, second := newInstance(), newInstance()
	headers := map[string]string{"X-Forwarded-For": ip}
	body := `{"loginId":"someone","password":"pw"}`

	for i := range authRateLimit {
		h := first
		if i%2 == 1 {
			h = second
		}
		if w := do(h, http.MethodPost, "/v1/auth/password", body, headers); w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401", i+1, w.Code)
		}
	}
	wantError(t, do(first, http.MethodPost, "/v1/auth/password", body, headers), http.StatusTooManyRequests, "rate_limited")
	wantError(t, do(second, http.MethodPost, "/v1/auth/logout", `{"refreshToken":"x"}`, headers), http.StatusTooManyRequests, "rate_limited")
	// Refresh keeps its own budget.
	if w := do(second, http.MethodPost, "/v1/auth/refresh", `{"refreshToken":"x"}`, headers); w.Code != http.StatusUnauthorized {
		t.Fatalf("refresh: status = %d, want 401", w.Code)
	}
}
