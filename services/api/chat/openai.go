package chat

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/openai"
)

const (
	// requestTimeout bounds one whole answer, from the request to the last
	// event.
	requestTimeout = 60 * time.Second
	// maxEventBytes is the longest server-sent event line accepted.
	maxEventBytes = 1 << 20
)

// Error is a streaming failure (the same *openai.Error, and so the same
// codes, as the learning package). Its string is only the Code, so it never
// carries the API key, the messages or the response body.
type Error = openai.Error

// Streamer calls the OpenAI Responses API with stream: true. HTTP should be
// set by main; nil uses a default client. BaseURL defaults to
// https://api.openai.com and may end with a slash.
type Streamer struct {
	HTTP    *http.Client
	BaseURL string
	APIKey  string
	Model   string
	// timeout replaces requestTimeout in tests.
	timeout time.Duration
}

// Stream asks ChatGPT to continue msgs and calls emit with each piece of the
// answer as it arrives. It returns nil once the answer is complete (or cut at
// the token limit), emit's own error if emit fails, and *Error otherwise.
// Cancelling ctx stops the generation.
func (s *Streamer) Stream(ctx context.Context, msgs []Message, emit func(text string) error) error {
	timeout := s.timeout
	if timeout == 0 {
		timeout = requestTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	input := make([]map[string]string, len(msgs))
	for i, m := range msgs {
		input[i] = map[string]string{"role": m.Role, "content": m.Text}
	}
	resp, err := openai.Request{
		HTTP: s.HTTP, BaseURL: s.BaseURL, APIKey: s.APIKey, Accept: "text/event-stream",
	}.Post(ctx, map[string]any{
		"model":             s.Model,
		"instructions":      SystemPrompt,
		"input":             input,
		"stream":            true,
		"store":             false,
		"max_output_tokens": maxOutputTokens,
		"reasoning":         map[string]any{"effort": "medium"},
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64<<10), maxEventBytes)
	for sc.Scan() {
		data, ok := strings.CutPrefix(sc.Text(), "data:")
		if !ok {
			continue // event names, comments and blank separators
		}
		var ev struct {
			Type     string            `json:"type"`
			Delta    string            `json:"delta"`
			Response *finishedResponse `json:"response"`
		}
		if err := json.Unmarshal([]byte(strings.TrimSpace(data)), &ev); err != nil {
			return openai.Fail(openai.CodeInvalidResponse)
		}
		switch ev.Type {
		case "response.output_text.delta":
			if ev.Delta == "" {
				continue
			}
			if err := emit(ev.Delta); err != nil {
				return err
			}
		case "response.completed", "response.incomplete":
			s.reportUsage(ctx, ev.Response)
			return nil
		case "response.failed", "error":
			s.reportUsage(ctx, ev.Response)
			return openai.Fail(openai.CodeInvalidResponse)
		}
	}
	if err := sc.Err(); err != nil {
		if errors.Is(err, bufio.ErrTooLong) {
			return openai.Fail(openai.CodeInvalidResponse)
		}
		return openai.TransportError(ctx, err)
	}
	if ctx.Err() != nil {
		return openai.TransportError(ctx, ctx.Err())
	}
	// The stream ended without saying the answer was complete.
	return openai.Fail(openai.CodeInvalidResponse)
}

// reportUsage passes the token counts of a finished response to the context's
// aiusage.Recorder. A response without usage reports nothing.
func (s *Streamer) reportUsage(ctx context.Context, resp *finishedResponse) {
	if resp == nil {
		return
	}
	openai.ReportUsage(ctx, s.Model, resp.Usage)
}

// finishedResponse is the part of the response in the final event that
// carries the token counts.
type finishedResponse struct {
	Usage *openai.Usage `json:"usage"`
}
