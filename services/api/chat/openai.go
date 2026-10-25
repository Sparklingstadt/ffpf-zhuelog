package chat

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	defaultBaseURL = "https://api.openai.com"
	// requestTimeout bounds one whole answer, from the request to the last
	// event.
	requestTimeout = 60 * time.Second
	// maxEventBytes is the longest server-sent event line accepted.
	maxEventBytes = 1 << 20
)

// Error is a streaming failure. Its string is only the Code (the same codes as
// the learning package), so it never carries the API key, the messages or the
// response body.
type Error struct{ Code string }

func (e *Error) Error() string { return e.Code }

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
	payload, err := json.Marshal(map[string]any{
		"model":             s.Model,
		"instructions":      SystemPrompt,
		"input":             input,
		"stream":            true,
		"store":             false,
		"max_output_tokens": maxOutputTokens,
		"reasoning":         map[string]any{"effort": "medium"},
	})
	if err != nil {
		return &Error{"OPENAI_REQUEST_FAILED"}
	}
	base := s.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/v1/responses", bytes.NewReader(payload))
	if err != nil {
		return &Error{"OPENAI_REQUEST_FAILED"}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)

	resp, err := s.client().Do(req)
	if err != nil {
		return transportError(ctx, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return &Error{"OPENAI_AUTH_FAILED"}
	case resp.StatusCode == http.StatusTooManyRequests:
		return &Error{"OPENAI_RATE_LIMITED"}
	case resp.StatusCode != http.StatusOK:
		return &Error{"OPENAI_REQUEST_FAILED"}
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64<<10), maxEventBytes)
	for sc.Scan() {
		data, ok := strings.CutPrefix(sc.Text(), "data:")
		if !ok {
			continue // event names, comments and blank separators
		}
		var ev struct {
			Type  string `json:"type"`
			Delta string `json:"delta"`
		}
		if err := json.Unmarshal([]byte(strings.TrimSpace(data)), &ev); err != nil {
			return &Error{"OPENAI_INVALID_RESPONSE"}
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
			return nil
		case "response.failed", "error":
			return &Error{"OPENAI_INVALID_RESPONSE"}
		}
	}
	if err := sc.Err(); err != nil {
		if errors.Is(err, bufio.ErrTooLong) {
			return &Error{"OPENAI_INVALID_RESPONSE"}
		}
		return transportError(ctx, err)
	}
	if ctx.Err() != nil {
		return transportError(ctx, ctx.Err())
	}
	// The stream ended without saying the answer was complete.
	return &Error{"OPENAI_INVALID_RESPONSE"}
}

// client returns the caller's client with redirects disabled (the request
// carries the API key), or a default one.
func (s *Streamer) client() *http.Client {
	c := &http.Client{}
	if s.HTTP != nil {
		copied := *s.HTTP
		c = &copied
	}
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return c
}

// transportError maps a failed round trip or read: any deadline is a timeout,
// everything else (including cancellation) is a request failure.
func transportError(ctx context.Context, err error) *Error {
	var ne net.Error
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) ||
		(errors.As(err, &ne) && ne.Timeout()) {
		return &Error{"OPENAI_TIMEOUT"}
	}
	return &Error{"OPENAI_REQUEST_FAILED"}
}
