package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
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

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
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

func TestNewNoRedirectHTTPClientRefusesRedirects(t *testing.T) {
	var targetHits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits.Add(1)
	}))
	defer target.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirector.Close()

	client := newNoRedirectHTTPClient(20 * time.Second)
	if client.Timeout != 20*time.Second {
		t.Errorf("Timeout = %v, want 20s", client.Timeout)
	}
	req, _ := http.NewRequest(http.MethodPost, redirector.URL, strings.NewReader(`{"key":"x"}`))
	req.Header.Set("Authorization", "Bearer secret")
	resp, err := client.Do(req)
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

type fakeMembers struct {
	exists map[string]bool
	err    error
	asked  []string
}

func (f *fakeMembers) MemberExists(_ context.Context, ownerID string) (bool, error) {
	f.asked = append(f.asked, ownerID)
	return f.exists[ownerID], f.err
}

func TestOwnerValid(t *testing.T) {
	allow := auth.ParseAllowlist("111, 222")
	members := &fakeMembers{exists: map[string]bool{"password:m1": true}}
	check := ownerValid(allow, members)
	ctx := context.Background()

	cases := []struct {
		name, owner, role string
		want              bool
		asksMembers       bool
	}{
		{"admin on the allowlist", "111", auth.RoleAdmin, true, false},
		{"admin removed from the allowlist", "999", auth.RoleAdmin, false, false},
		{"member that exists", "password:m1", auth.RoleMember, true, true},
		{"member that is gone", "password:m2", auth.RoleMember, false, true},
		{"guest", auth.GuestOwnerID, auth.RoleGuest, false, false},
		{"unknown role", "111", "owner", false, false},
		{"no role", "111", "", false, false},
		{"allowlisted ID with the member role is not enough", "111", auth.RoleMember, false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			members.asked = nil
			got, err := check(ctx, c.owner, c.role)
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Errorf("valid = %v, want %v", got, c.want)
			}
			if asked := len(members.asked) > 0; asked != c.asksMembers {
				t.Errorf("asked members = %v, want %v", asked, c.asksMembers)
			}
		})
	}

	members.err = errors.New("db down")
	if _, err := check(ctx, "password:m1", auth.RoleMember); err == nil {
		t.Error("a store error was swallowed")
	}
}

func TestRunStartupFailureDoesNotLeakDatabaseURL(t *testing.T) {
	const secret = "s3cret-password"
	cfg := Config{
		Port:               "0",
		DatabaseURL:        "postgres://user:" + secret + "@127.0.0.1:1/db?sslmode=disable&connect_timeout=1",
		JWTSecret:          bytes.Repeat([]byte("k"), 32),
		GitHubClientID:     "id",
		GitHubClientSecret: "secret",
		GitHubRedirectURI:  "app://callback",
		AllowedGitHubIDs:   "1",
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

	// Two more members for the follow round trip: B shares an entry, C is a
	// bystander whose shared entry must not reach A's timeline.
	type member struct{ accountID, loginID, owner string }
	newMember := func(suffix string) member {
		m := member{accountID: accountID + suffix}
		m.loginID, m.owner = "e2e-"+m.accountID, "password:"+m.accountID
		if _, err := conn.Exec(setup,
			`INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "updatedAt")
			 VALUES ($1, $2, $3, $4, now())`, m.accountID, m.loginID, "E2E-"+suffix, hash); err != nil {
			t.Fatalf("insert account %s: %v", suffix, err)
		}
		t.Cleanup(func() {
			ctx := context.Background()
			_, _ = conn.Exec(ctx,
				`DELETE FROM "ImportBatch" WHERE id IN (SELECT "batchId" FROM "LearningEntry" WHERE "ownerId" = $1)`, m.owner)
			_, _ = conn.Exec(ctx, `DELETE FROM "Follow" WHERE "followerId" = $1 OR "followeeId" = $1`, m.owner)
			_, _ = conn.Exec(ctx, `DELETE FROM "ApiRefreshToken" WHERE "ownerId" = $1`, m.owner)
			_, _ = conn.Exec(ctx, `DELETE FROM "PasswordAccount" WHERE id = $1`, m.accountID)
		})
		return m
	}
	memberB, memberC := newMember("b"), newMember("c")

	// Every sign-in below comes from 127.0.0.1, whose per-client count lives
	// in the shared DB; start each run from zero so reruns within the
	// 15-minute window are not throttled.
	clearThrottle := func() {
		_, _ = conn.Exec(context.Background(),
			`DELETE FROM "SignInThrottle" WHERE "key" = 'client:127.0.0.1' OR "key" LIKE 'login:127.0.0.1:e2e-%'`)
	}
	clearThrottle()
	t.Cleanup(clearThrottle)
	throttleCount := func(key string) int {
		t.Helper()
		var n int
		err := conn.QueryRow(context.Background(), `SELECT "count" FROM "SignInThrottle" WHERE "key" = $1`, key).Scan(&n)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0
		}
		if err != nil {
			t.Fatalf("read throttle %s: %v", key, err)
		}
		return n
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM "Follow" WHERE "followerId" = $1 OR "followeeId" = $1`, owner)
	})

	cfg := Config{
		Port:               "0",
		DatabaseURL:        dbURL,
		JWTSecret:          bytes.Repeat([]byte("e2e-secret-"), 4),
		GitHubClientID:     "dummy-client-id",
		GitHubClientSecret: "dummy-client-secret",
		GitHubRedirectURI:  "zhuelog://oauth/callback",
		AllowedGitHubIDs:   "1",
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

	// No LINE settings in cfg: the LINE routes are not registered.
	if code := c.do("POST", "/v1/line/webhook", "", nil, nil); code != http.StatusNotFound {
		t.Fatalf("webhook without LINE settings = %d, want 404", code)
	}
	if code := c.do("GET", "/v1/line/drain", "", nil, nil); code != http.StatusNotFound {
		t.Fatalf("drain without LINE settings = %d, want 404", code)
	}

	var first tokens
	if code := c.do("POST", "/v1/auth/password", "",
		map[string]string{"loginId": loginID, "password": "correct horse battery"}, &first); code != http.StatusOK {
		t.Fatalf("password login = %d", code)
	}
	if first.AccessToken == "" || first.RefreshToken == "" {
		t.Fatalf("empty tokens: %+v", first)
	}

	// Throttle keys shared with the web: a wrong password counts per client
	// and per loginId; a success resets only the loginId count.
	if code := c.do("POST", "/v1/auth/password", "",
		map[string]string{"loginId": memberC.loginID, "password": "wrong password"}, nil); code != http.StatusUnauthorized {
		t.Fatalf("wrong password = %d, want 401", code)
	}
	if n := throttleCount("login:127.0.0.1:" + memberC.loginID); n != 1 {
		t.Fatalf("login throttle count = %d, want 1", n)
	}
	if n := throttleCount("login:127.0.0.1:" + loginID); n != 0 {
		t.Fatalf("login throttle count after success = %d, want 0", n)
	}
	if n := throttleCount("client:127.0.0.1"); n != 2 {
		t.Fatalf("client throttle count = %d, want 2", n)
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

	// Follow round trip: B and C each share an entry, A follows B only.
	shareEntry := func(m member, text string) {
		t.Helper()
		var tk tokens
		if code := c.do("POST", "/v1/auth/password", "",
			map[string]string{"loginId": m.loginID, "password": "correct horse battery"}, &tk); code != http.StatusOK {
			t.Fatalf("login %s = %d", m.loginID, code)
		}
		var made struct {
			Entries []entryResp `json:"entries"`
		}
		if code := c.do("POST", "/v1/batches", tk.AccessToken, map[string]any{
			"entries": []map[string]any{{"originalText": text, "correctedText": text + "!", "pinyin": "p"}},
		}, &made); code != http.StatusCreated || len(made.Entries) != 1 {
			t.Fatalf("create batch for %s = %d", m.loginID, code)
		}
		if code := c.do("PUT", "/v1/entries/"+made.Entries[0].ID+"/share", tk.AccessToken, nil, nil); code != http.StatusOK {
			t.Fatalf("share = %d", code)
		}
	}
	shareEntry(memberB, "from b")
	shareEntry(memberC, "from c")

	var members struct {
		Members []struct {
			OwnerID     string `json:"ownerId"`
			DisplayName string `json:"displayName"`
			Following   bool   `json:"following"`
		} `json:"members"`
		FollowingCount int `json:"followingCount"`
	}
	if code := c.do("GET", "/v1/members", second.AccessToken, nil, &members); code != http.StatusOK {
		t.Fatalf("members = %d", code)
	}
	listed := map[string]bool{}
	for _, m := range members.Members {
		listed[m.OwnerID] = m.Following
	}
	if _, ok := listed[memberB.owner]; !ok || listed[memberB.owner] || members.FollowingCount != 0 {
		t.Fatalf("members before follow = %+v", members)
	}
	if code := c.do("PUT", "/v1/follows/"+owner, second.AccessToken, nil, nil); code != http.StatusBadRequest {
		t.Fatalf("self follow = %d, want 400", code)
	}
	if code := c.do("PUT", "/v1/follows/"+memberB.owner, second.AccessToken, nil, nil); code != http.StatusNoContent {
		t.Fatalf("follow = %d", code)
	}
	var timeline struct {
		Items []struct {
			Entry     entryResp `json:"entry"`
			OwnerID   string    `json:"ownerId"`
			OwnerName string    `json:"ownerName"`
		} `json:"items"`
		NextCursor *string `json:"nextCursor"`
	}
	if code := c.do("GET", "/v1/timeline", second.AccessToken, nil, &timeline); code != http.StatusOK {
		t.Fatalf("timeline = %d", code)
	}
	if len(timeline.Items) != 1 || timeline.Items[0].OwnerID != memberB.owner ||
		timeline.Items[0].OwnerName != "E2E-b" || timeline.Items[0].Entry.OriginalText != "from b" || timeline.NextCursor != nil {
		t.Fatalf("timeline = %+v", timeline)
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

// TestRunLineRoutesEndToEnd runs the server with the LINE settings against a
// fake LINE API: a member issues a link code, sends it from LINE, sees the
// link and removes it. OpenAI is never reached.
func TestRunLineRoutesEndToEnd(t *testing.T) {
	dbURL := os.Getenv("API_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("API_TEST_DATABASE_URL is not set")
	}
	hashBytes, err := os.ReadFile("auth/testdata/node_scrypt_hash.txt")
	if err != nil {
		t.Fatalf("read hash: %v", err)
	}
	hash := strings.TrimSpace(string(hashBytes))

	conn := directConn(t, dbURL)
	accountID := "cline" + strings.ToLower(strings.ReplaceAll(time.Now().Format("150405.000000"), ".", ""))
	loginID := "e2e-" + accountID
	owner := "password:" + accountID
	lineUser := "U" + accountID
	if _, err := conn.Exec(context.Background(),
		`INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "updatedAt")
		 VALUES ($1, $2, $3, $4, now())`, accountID, loginID, "E2E", hash); err != nil {
		t.Fatalf("insert account: %v", err)
	}
	clearThrottle := func() {
		_, _ = conn.Exec(context.Background(),
			`DELETE FROM "SignInThrottle" WHERE "key" = 'client:127.0.0.1' OR "key" LIKE 'login:127.0.0.1:e2e-%' OR "key" = $1`,
			"line-link:"+lineUser)
	}
	clearThrottle()
	t.Cleanup(func() {
		ctx := context.Background()
		clearThrottle()
		_, _ = conn.Exec(ctx, `DELETE FROM "LineLink" WHERE "ownerId" = $1`, owner)
		_, _ = conn.Exec(ctx, `DELETE FROM "LineLinkCode" WHERE "ownerId" = $1`, owner)
		_, _ = conn.Exec(ctx, `DELETE FROM "ApiRefreshToken" WHERE "ownerId" = $1`, owner)
		_, _ = conn.Exec(ctx, `DELETE FROM "PasswordAccount" WHERE id = $1`, accountID)
	})

	var replies atomic.Int32
	fakeLine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/bot/message/reply" && r.Header.Get("Authorization") == "Bearer line-access-token" {
			replies.Add(1)
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer fakeLine.Close()

	channelSecret := "e2e-line-channel-secret"
	cfg := Config{
		Port:                   "0",
		DatabaseURL:            dbURL,
		JWTSecret:              bytes.Repeat([]byte("e2e-secret-"), 4),
		GitHubClientID:         "dummy-client-id",
		GitHubClientSecret:     "dummy-client-secret",
		GitHubRedirectURI:      "zhuelog://oauth/callback",
		AllowedGitHubIDs:       "1",
		LineChannelSecret:      []byte(channelSecret),
		LineChannelAccessToken: "line-access-token",
		OpenAIAPIKey:           "openai-key",
		CronSecret:             []byte("e2e-cron-secret"),
		OpenAIBaseURL:          "http://127.0.0.1:1",
		LineAPIBaseURL:         fakeLine.URL,
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan string, 1)
	done := make(chan error, 1)
	go func() { done <- run(ctx, cfg, slog.New(slog.NewJSONHandler(io.Discard, nil)), ready) }()
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
	c := apiClient{t: t, base: base}

	var tok tokens
	if code := c.do("POST", "/v1/auth/password", "",
		map[string]string{"loginId": loginID, "password": "correct horse battery"}, &tok); code != http.StatusOK {
		t.Fatalf("password login = %d", code)
	}

	var linked struct {
		Linked bool `json:"linked"`
	}
	if code := c.do("GET", "/v1/line/link", tok.AccessToken, nil, &linked); code != http.StatusOK || linked.Linked {
		t.Fatalf("GET link before = %d %+v", code, linked)
	}
	var issued struct {
		Code      string `json:"code"`
		ExpiresAt string `json:"expiresAt"`
	}
	if code := c.do("POST", "/v1/line/link-code", tok.AccessToken, nil, &issued); code != http.StatusOK || len(issued.Code) != 8 || issued.ExpiresAt == "" {
		t.Fatalf("POST link-code = %d %+v", code, issued)
	}

	body := `{"destination":"x","events":[{"type":"message","webhookEventId":"` + accountID + `","replyToken":"rt","source":{"type":"user","userId":"` + lineUser + `"},"message":{"type":"text","text":"` + issued.Code + `"}}]}`
	mac := hmac.New(sha256.New, []byte(channelSecret))
	mac.Write([]byte(body))
	post := func(sig string) int {
		req, _ := http.NewRequest("POST", base+"/v1/line/webhook", strings.NewReader(body))
		req.Header.Set("X-Line-Signature", sig)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("webhook: %v", err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := post("bogus"); code != http.StatusUnauthorized {
		t.Fatalf("webhook with a bad signature = %d, want 401", code)
	}
	if code := post(base64.StdEncoding.EncodeToString(mac.Sum(nil))); code != http.StatusOK {
		t.Fatalf("webhook = %d, want 200", code)
	}
	if n := replies.Load(); n != 1 {
		t.Errorf("LINE replies = %d, want 1 (the linked notice)", n)
	}

	if code := c.do("GET", "/v1/line/link", tok.AccessToken, nil, &linked); code != http.StatusOK || !linked.Linked {
		t.Fatalf("GET link after = %d %+v", code, linked)
	}

	drain := func(header string) int {
		req, _ := http.NewRequest("GET", base+"/v1/line/drain", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("drain: %v", err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := drain(""); code != http.StatusUnauthorized {
		t.Errorf("drain without a secret = %d, want 401", code)
	}
	if code := drain("Bearer e2e-cron-secret"); code != http.StatusNoContent {
		t.Errorf("drain = %d, want 204", code)
	}

	if code := c.do("DELETE", "/v1/line/link", tok.AccessToken, nil, nil); code != http.StatusNoContent {
		t.Fatalf("DELETE link = %d", code)
	}
	if code := c.do("DELETE", "/v1/line/link", tok.AccessToken, nil, nil); code != http.StatusNoContent {
		t.Fatalf("second DELETE link = %d, want 204", code)
	}
	if code := c.do("GET", "/v1/line/link", tok.AccessToken, nil, &linked); code != http.StatusOK || linked.Linked {
		t.Fatalf("GET link after unlink = %d %+v", code, linked)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("run did not stop")
	}
}
