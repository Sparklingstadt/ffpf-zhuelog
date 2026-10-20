package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestNewGitHubHTTPClientRefusesRedirects(t *testing.T) {
	var targetHits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits.Add(1)
	}))
	defer target.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirector.Close()

	client := newGitHubHTTPClient()
	if client.Timeout != 10*time.Second {
		t.Errorf("Timeout = %v, want 10s", client.Timeout)
	}
	resp, err := client.Post(redirector.URL, "application/json", strings.NewReader(`{"client_secret":"x"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTemporaryRedirect {
		t.Errorf("status = %d, want 307 returned as is", resp.StatusCode)
	}
	if n := targetHits.Load(); n != 0 {
		t.Errorf("redirect target was contacted %d times", n)
	}
}

func TestRunStartupFailureDoesNotLeakDatabaseURL(t *testing.T) {
	const secret = "s3cret-password"
	cfg := Config{
		Port:                "0",
		DatabaseURL:         "postgres://user:" + secret + "@127.0.0.1:1/db?sslmode=disable&connect_timeout=1",
		JWTSecret:           bytes.Repeat([]byte("k"), 32),
		GitHubClientID:      "id",
		GitHubClientSecret:  "secret",
		GitHubRedirectURI:   "app://callback",
		AllowedGitHubLogins: "someone",
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

type apiClient struct {
	t    *testing.T
	base string
}

// do sends a request and decodes a JSON response into out (when non-nil).
func (c apiClient) do(method, path, token string, body any, out any) int {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			c.t.Fatalf("marshal: %v", err)
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rd)
	if err != nil {
		c.t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			c.t.Fatalf("%s %s: decode %q: %v", method, path, raw, err)
		}
	}
	return resp.StatusCode
}

type tokens struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
}

type entryResp struct {
	ID            string `json:"id"`
	OriginalText  string `json:"originalText"`
	CorrectedText string `json:"correctedText"`
}

type listResp struct {
	Entries []entryResp `json:"entries"`
}

// directConn opens a plain pgx connection for fixtures (Prisma's ?schema=
// parameter is not accepted by pgx).
func directConn(t *testing.T, rawURL string) *pgx.Conn {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse test database url: %v", err)
	}
	q := u.Query()
	q.Del("schema")
	u.RawQuery = q.Encode()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, u.String())
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

func TestRunEndToEnd(t *testing.T) {
	dbURL := os.Getenv("API_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("API_TEST_DATABASE_URL is not set")
	}
	hashBytes, err := os.ReadFile("auth/testdata/node_scrypt_hash.txt")
	if err != nil {
		t.Fatalf("read hash: %v", err)
	}
	hash := strings.TrimSpace(string(hashBytes))

	// Fixture: a member account that can sign in with the Task 5 test hash.
	conn := directConn(t, dbURL)
	accountID := "ce2e" + strings.ToLower(strings.ReplaceAll(time.Now().Format("150405.000000"), ".", ""))
	loginID := "e2e-" + accountID
	owner := "password:" + accountID
	setup := context.Background()
	if _, err := conn.Exec(setup,
		`INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "updatedAt")
		 VALUES ($1, $2, $3, $4, now())`, accountID, loginID, "E2E", hash); err != nil {
		t.Fatalf("insert account: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = conn.Exec(ctx,
			`DELETE FROM "ImportBatch" WHERE id IN (SELECT "batchId" FROM "LearningEntry" WHERE "ownerId" = $1)`, owner)
		_, _ = conn.Exec(ctx, `DELETE FROM "ApiRefreshToken" WHERE "ownerId" = $1`, owner)
		_, _ = conn.Exec(ctx, `DELETE FROM "PasswordAccount" WHERE id = $1`, accountID)
	})

	cfg := Config{
		Port:                "0",
		DatabaseURL:         dbURL,
		JWTSecret:           bytes.Repeat([]byte("e2e-secret-"), 4),
		GitHubClientID:      "dummy-client-id",
		GitHubClientSecret:  "dummy-client-secret",
		GitHubRedirectURI:   "zhuelog://oauth/callback",
		AllowedGitHubLogins: "nobody",
	}
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
	c := apiClient{t: t, base: "http://" + net.JoinHostPort("127.0.0.1", port)}

	for _, path := range []string{"/health", "/healthz"} {
		if code := c.do("GET", path, "", nil, nil); code != http.StatusOK {
			t.Fatalf("%s = %d", path, code)
		}
	}

	var first tokens
	if code := c.do("POST", "/v1/auth/password", "",
		map[string]string{"loginId": loginID, "password": "correct horse battery"}, &first); code != http.StatusOK {
		t.Fatalf("password login = %d", code)
	}
	if first.AccessToken == "" || first.RefreshToken == "" {
		t.Fatalf("empty tokens: %+v", first)
	}

	var created struct {
		Entries []entryResp `json:"entries"`
	}
	if code := c.do("POST", "/v1/batches", first.AccessToken, map[string]any{
		"entries": []map[string]any{{
			"originalText": "你好吗", "correctedText": "你好吗？", "pinyin": "nǐ hǎo ma", "hints": []string{"greeting"},
		}},
	}, &created); code != http.StatusCreated {
		t.Fatalf("create batch = %d", code)
	}
	if len(created.Entries) != 1 {
		t.Fatalf("created %d entries", len(created.Entries))
	}
	id := created.Entries[0].ID

	var list listResp
	if code := c.do("GET", "/v1/entries", first.AccessToken, nil, &list); code != http.StatusOK || len(list.Entries) != 1 {
		t.Fatalf("list = %d, %d entries; want 200, 1", code, len(list.Entries))
	}

	var patched entryResp
	if code := c.do("PATCH", "/v1/entries/"+id, first.AccessToken,
		map[string]string{"correctedText": "你好吗？！"}, &patched); code != http.StatusOK {
		t.Fatalf("patch = %d", code)
	}
	if patched.CorrectedText != "你好吗？！" {
		t.Errorf("patched correctedText = %q", patched.CorrectedText)
	}

	if code := c.do("DELETE", "/v1/entries/"+id, first.AccessToken, nil, nil); code != http.StatusNoContent {
		t.Fatalf("delete = %d", code)
	}
	list = listResp{}
	if code := c.do("GET", "/v1/entries", first.AccessToken, nil, &list); code != http.StatusOK || len(list.Entries) != 0 {
		t.Fatalf("list after delete = %d, %d entries; want 200, 0", code, len(list.Entries))
	}

	var second tokens
	if code := c.do("POST", "/v1/auth/refresh", "",
		map[string]string{"refreshToken": first.RefreshToken}, &second); code != http.StatusOK {
		t.Fatalf("refresh = %d", code)
	}
	if second.AccessToken == "" || second.RefreshToken == "" || second.RefreshToken == first.RefreshToken {
		t.Errorf("refresh did not return a new pair: %+v", second)
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

func TestShutdownTimeoutFitsCloudRunGrace(t *testing.T) {
	// Cloud Run sends SIGKILL 10 seconds after SIGTERM.
	if shutdownTimeout != 8*time.Second {
		t.Fatalf("shutdownTimeout = %v, want 8s (under Cloud Run's 10s grace)", shutdownTimeout)
	}
}
