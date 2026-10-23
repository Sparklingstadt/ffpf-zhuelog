package line

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type captured struct {
	method, path, auth, contentType string
	body                            map[string]any
}

func newServer(t *testing.T, status int) (*httptest.Server, *captured) {
	t.Helper()
	got := &captured{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method, got.path = r.Method, r.URL.Path
		got.auth = r.Header.Get("Authorization")
		got.contentType = r.Header.Get("Content-Type")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got.body)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"message":"detail"}`))
	}))
	t.Cleanup(srv.Close)
	return srv, got
}

func messageTexts(t *testing.T, body map[string]any) []string {
	t.Helper()
	msgs, _ := body["messages"].([]any)
	var out []string
	for _, m := range msgs {
		mm := m.(map[string]any)
		if mm["type"] != "text" {
			t.Fatalf("message type = %v", mm["type"])
		}
		out = append(out, mm["text"].(string))
	}
	return out
}

func TestReply(t *testing.T) {
	srv, got := newServer(t, http.StatusOK)
	c := &Client{HTTP: srv.Client(), BaseURL: srv.URL, AccessToken: "tok-secret"}
	if err := c.Reply(context.Background(), "reply-token", "one", "two"); err != nil {
		t.Fatal(err)
	}
	if got.method != http.MethodPost || got.path != "/v2/bot/message/reply" {
		t.Fatalf("request = %s %s", got.method, got.path)
	}
	if got.auth != "Bearer tok-secret" {
		t.Fatalf("Authorization = %q", got.auth)
	}
	if !strings.HasPrefix(got.contentType, "application/json") {
		t.Fatalf("Content-Type = %q", got.contentType)
	}
	if got.body["replyToken"] != "reply-token" {
		t.Fatalf("replyToken = %v", got.body["replyToken"])
	}
	if texts := messageTexts(t, got.body); len(texts) != 2 || texts[0] != "one" || texts[1] != "two" {
		t.Fatalf("texts = %v", texts)
	}
}

func TestPush(t *testing.T) {
	srv, got := newServer(t, http.StatusOK)
	c := &Client{HTTP: srv.Client(), BaseURL: srv.URL, AccessToken: "tok"}
	if err := c.Push(context.Background(), "U123", "hello"); err != nil {
		t.Fatal(err)
	}
	if got.path != "/v2/bot/message/push" || got.body["to"] != "U123" || got.auth != "Bearer tok" {
		t.Fatalf("got = %#v", got)
	}
	if texts := messageTexts(t, got.body); len(texts) != 1 || texts[0] != "hello" {
		t.Fatalf("texts = %v", texts)
	}
}

func TestBaseURLTrailingSlash(t *testing.T) {
	srv, got := newServer(t, http.StatusOK)
	c := &Client{HTTP: srv.Client(), BaseURL: srv.URL + "/", AccessToken: "tok"}
	if err := c.Reply(context.Background(), "rt", "x"); err != nil {
		t.Fatal(err)
	}
	if got.path != "/v2/bot/message/reply" {
		t.Fatalf("path = %q", got.path)
	}
}

func TestStatusErrorsDoNotLeakSecrets(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusTooManyRequests, http.StatusInternalServerError} {
		srv, _ := newServer(t, status)
		c := &Client{HTTP: srv.Client(), BaseURL: srv.URL, AccessToken: "tok-secret"}
		err := c.Reply(context.Background(), "rt-secret", "message-body-secret")
		if err == nil {
			t.Fatalf("status %d: want error", status)
		}
		for _, leak := range []string{"tok-secret", "rt-secret", "message-body-secret", "detail"} {
			if strings.Contains(err.Error(), leak) {
				t.Fatalf("status %d: error %q leaks %q", status, err, leak)
			}
		}
	}
}

func TestTransportErrorDoesNotLeakSecrets(t *testing.T) {
	srv, _ := newServer(t, http.StatusOK)
	url := srv.URL
	srv.Close()
	c := &Client{HTTP: http.DefaultClient, BaseURL: url, AccessToken: "tok-secret"}
	err := c.Push(context.Background(), "U-secret", "message-body-secret")
	if err == nil {
		t.Fatal("want error")
	}
	for _, leak := range []string{"tok-secret", "U-secret", "message-body-secret"} {
		if strings.Contains(err.Error(), leak) {
			t.Fatalf("error %q leaks %q", err, leak)
		}
	}
}

func TestMessageCountLimits(t *testing.T) {
	srv, got := newServer(t, http.StatusOK)
	c := &Client{HTTP: srv.Client(), BaseURL: srv.URL, AccessToken: "tok"}
	if err := c.Reply(context.Background(), "rt"); err == nil {
		t.Fatal("zero messages: want error")
	}
	six := []string{"1", "2", "3", "4", "5", "6"}
	if err := c.Push(context.Background(), "U1", six...); err == nil {
		t.Fatal("six messages: want error")
	}
	if got.path != "" {
		t.Fatalf("request was sent despite invalid count: %s", got.path)
	}
	if err := c.Push(context.Background(), "U1", six[:5]...); err != nil {
		t.Fatalf("five messages: %v", err)
	}
}

func TestContextCancelled(t *testing.T) {
	srv, _ := newServer(t, http.StatusOK)
	c := &Client{HTTP: srv.Client(), BaseURL: srv.URL, AccessToken: "tok"}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := c.Reply(ctx, "rt", "x"); err == nil {
		t.Fatal("want error")
	}
}
