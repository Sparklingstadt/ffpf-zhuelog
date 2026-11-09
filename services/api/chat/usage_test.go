package chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/aiusage"
)

func TestStreamReportsUsageOfTheFinalEvent(t *testing.T) {
	for name, final := range map[string]string{
		"completed":  `{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":120,"output_tokens":45}}}`,
		"incomplete": `{"type":"response.incomplete","response":{"status":"incomplete","usage":{"input_tokens":120,"output_tokens":45}}}`,
		"failed":     `{"type":"response.failed","response":{"status":"failed","usage":{"input_tokens":120,"output_tokens":45}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				sse(w, created)
				sse(w, delta("你"))
				sse(w, final)
			}))
			defer srv.Close()

			var got []aiusage.Usage
			ctx := aiusage.WithRecorder(context.Background(), func(_ context.Context, u aiusage.Usage) { got = append(got, u) })
			_, _ = collect(t, streamer(srv.URL), ctx, []Message{{Role: "user", Text: "hi"}})
			want := aiusage.Usage{Model: "gpt-test", InputTokens: 120, OutputTokens: 45}
			if len(got) != 1 || got[0] != want {
				t.Fatalf("reports = %+v, want [%+v]", got, want)
			}
		})
	}
}

func TestStreamWithoutUsageReportsNothing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		sse(w, delta("你"))
		sse(w, completed)
	}))
	defer srv.Close()

	var got []aiusage.Usage
	ctx := aiusage.WithRecorder(context.Background(), func(_ context.Context, u aiusage.Usage) { got = append(got, u) })
	if _, err := collect(t, streamer(srv.URL), ctx, []Message{{Role: "user", Text: "hi"}}); err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("reports = %+v, want none", got)
	}
}
