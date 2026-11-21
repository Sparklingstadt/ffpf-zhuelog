package main

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRunStartupFailureDoesNotLeakDatabaseURL(t *testing.T) {
	const secret = "s3cret-password"
	cfg := Config{
		Port:        "0",
		DatabaseURL: "postgres://user:" + secret + "@127.0.0.1:1/db?sslmode=disable&connect_timeout=1",
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	err := run(ctx, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	if err == nil {
		t.Fatal("run succeeded against an unreachable database")
	}
	if strings.Contains(err.Error(), secret) {
		t.Errorf("error leaks the database password: %v", err)
	}
}

// TestRunEndToEnd starts the server against the test database and checks
// that only the health routes are left.
func TestRunEndToEnd(t *testing.T) {
	dbURL := os.Getenv("API_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("API_TEST_DATABASE_URL is not set")
	}
	cfg := Config{Port: "0", DatabaseURL: dbURL}
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan string, 1)
	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg, logger, ready) }()

	var addr string
	select {
	case addr = <-ready:
	case err := <-done:
		t.Fatalf("run exited before ready: %v", err)
	case <-time.After(20 * time.Second):
		t.Fatal("run did not become ready")
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("bad ready address %q: %v", addr, err)
	}
	base := "http://" + net.JoinHostPort("127.0.0.1", port)

	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{http.MethodGet, "/ping", http.StatusOK},
		{http.MethodGet, "/health", http.StatusOK},
		{http.MethodPost, "/v1/auth/password", http.StatusNotFound},
	} {
		req, err := http.NewRequest(tc.method, base+tc.path, strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("new request: %v", err)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", tc.method, tc.path, err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != tc.want {
			t.Errorf("%s %s = %d, want %d", tc.method, tc.path, resp.StatusCode, tc.want)
		}
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("run returned %v on shutdown", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run did not return within 10s of cancel")
	}
}

func TestShutdownTimeoutFitsStopGrace(t *testing.T) {
	// ECS sends SIGKILL 30 seconds after SIGTERM by default.
	if shutdownTimeout != 8*time.Second {
		t.Fatalf("shutdownTimeout = %v, want 8s (well under ECS's 30s stop timeout)", shutdownTimeout)
	}
}
