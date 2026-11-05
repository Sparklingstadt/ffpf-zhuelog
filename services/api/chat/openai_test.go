package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

// sse writes one server-sent event the way the Responses API does.
func sse(w io.Writer, payload string) {
	var v struct{ Type string }
	_ = json.Unmarshal([]byte(payload), &v)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", v.Type, payload)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func delta(text string) string {
	b, _ := json.Marshal(map[string]string{"type": "response.output_text.delta", "delta": text})
	return string(b)
}

const (
	created   = `{"type":"response.created","response":{"status":"in_progress"}}`
	completed = `{"type":"response.completed","response":{"status":"completed"}}`
)

func streamer(url string) *Streamer {
	return &Streamer{HTTP: &http.Client{}, BaseURL: url, APIKey: "sk-test", Model: "gpt-test"}
}

func collect(t *testing.T, s *Streamer, ctx context.Context, msgs []Message) ([]string, error) {
	t.Helper()
	var got []string
	err := s.Stream(ctx, msgs, func(text string) error {
		got = append(got, text)
		return nil
	})
	return got, err
}

func code(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func TestStreamSendsModelPromptAndStoreFalse(t *testing.T) {
	var body map[string]any
	var auth, path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth, path = r.Header.Get("Authorization"), r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		sse(w, completed)
	}))
	defer srv.Close()

	msgs := []Message{{Role: "user", Text: "你好"}, {Role: "assistant", Text: "你好！"}, {Role: "user", Text: "谢谢"}}
	if _, err := collect(t, streamer(srv.URL+"/"), context.Background(), msgs); err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer sk-test" || path != "/v1/responses" {
		t.Errorf("auth %q, path %q", auth, path)
	}
	want := map[string]any{
		"model":             "gpt-test",
		"instructions":      SystemPrompt,
		"stream":            true,
		"store":             false,
		"max_output_tokens": float64(1600),
		"reasoning":         map[string]any{"effort": "medium"},
		"input": []any{
			map[string]any{"role": "user", "content": "你好"},
			map[string]any{"role": "assistant", "content": "你好！"},
			map[string]any{"role": "user", "content": "谢谢"},
		},
	}
	if !reflect.DeepEqual(body, want) {
		t.Errorf("body = %#v\nwant %#v", body, want)
	}
}

func TestStreamEmitsOnlyTextDeltas(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		sse(w, created)
		sse(w, `{"type":"response.output_item.added"}`)
		sse(w, delta("你"))
		sse(w, delta("好"))
		sse(w, `{"type":"response.output_text.done","text":"你好"}`)
		sse(w, completed)
	}))
	defer srv.Close()

	got, err := collect(t, streamer(srv.URL), context.Background(), []Message{{Role: "user", Text: "hi"}})
	if err != nil || !reflect.DeepEqual(got, []string{"你", "好"}) {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestStreamIncompleteCountsAsDone(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		sse(w, delta("你"))
		sse(w, `{"type":"response.incomplete","response":{"status":"incomplete"}}`)
	}))
	defer srv.Close()

	if got, err := collect(t, streamer(srv.URL), context.Background(), []Message{{Role: "user", Text: "hi"}}); err != nil || len(got) != 1 {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestStreamFailedEventsAndStatuses(t *testing.T) {
	cases := []struct {
		name   string
		status int
		events []string
		want   string
	}{
		{"error event", 200, []string{delta("你"), `{"type":"error","message":"boom"}`}, "OPENAI_INVALID_RESPONSE"},
		{"failed", 200, []string{`{"type":"response.failed","response":{"status":"failed"}}`}, "OPENAI_INVALID_RESPONSE"},
		{"no completed", 200, []string{delta("你")}, "OPENAI_INVALID_RESPONSE"},
		{"401", 401, nil, "OPENAI_AUTH_FAILED"},
		{"403", 403, nil, "OPENAI_AUTH_FAILED"},
		{"429", 429, nil, "OPENAI_RATE_LIMITED"},
		{"500", 500, nil, "OPENAI_REQUEST_FAILED"},
		{"400", 400, nil, "OPENAI_REQUEST_FAILED"},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
			for _, ev := range tc.events {
				sse(w, ev)
			}
		}))
		_, err := collect(t, streamer(srv.URL), context.Background(), []Message{{Role: "user", Text: "hi"}})
		srv.Close()
		if code(err) != tc.want {
			t.Errorf("%s: err = %v, want %s", tc.name, err, tc.want)
		}
		if err != nil && strings.Contains(err.Error(), "sk-test") {
			t.Errorf("%s: error leaks the key", tc.name)
		}
	}
}

func TestStreamReturnsEmitError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		sse(w, delta("你"))
		sse(w, completed)
	}))
	defer srv.Close()

	stop := errors.New("client went away")
	err := streamer(srv.URL).Stream(context.Background(), []Message{{Role: "user", Text: "hi"}}, func(string) error { return stop })
	if !errors.Is(err, stop) {
		t.Fatalf("err = %v, want the emit error", err)
	}
}

func TestStreamStopsWhenContextCancelled(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sse(w, delta("你"))
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer srv.Close()
	defer close(release)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- streamer(srv.URL).Stream(ctx, []Message{{Role: "user", Text: "hi"}}, func(string) error {
			cancel()
			return nil
		})
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Stream returned nil after cancel")
		}
	case <-time.After(time.Second):
		t.Fatal("Stream did not stop within 1s of cancel")
	}
}

func TestStreamTimesOut(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sse(w, delta("你"))
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer srv.Close()
	defer close(release)

	s := streamer(srv.URL)
	s.timeout = 50 * time.Millisecond
	if _, err := collect(t, s, context.Background(), []Message{{Role: "user", Text: "hi"}}); code(err) != "OPENAI_TIMEOUT" {
		t.Fatalf("err = %v, want OPENAI_TIMEOUT", err)
	}
}

func TestQuickQuestionPromptAndIncompleteAnswer(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		sse(w, delta("途中"))
		sse(w, `{"type":"response.incomplete"}`)
	}))
	defer srv.Close()
	s := streamer(srv.URL)
	s.Instructions = QuickQuestionPrompt
	s.RequireComplete = true
	_, err := collect(t, s, context.Background(), []Message{{Role: "user", Text: "了？"}})
	if code(err) != "OPENAI_INCOMPLETE_RESPONSE" {
		t.Fatalf("error = %v", err)
	}
	if body["instructions"] != QuickQuestionPrompt {
		t.Fatalf("instructions = %v", body["instructions"])
	}
}
