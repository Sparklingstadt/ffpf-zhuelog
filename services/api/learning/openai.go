// Package learning generates Chinese-learning material (a correction or a
// translation, with pinyin and hints) from a user's text through OpenAI.
package learning

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	// KindCorrection corrects a Chinese sentence; KindTranslation turns
	// Japanese into Chinese.
	KindCorrection  = "correction"
	KindTranslation = "translation"

	defaultBaseURL = "https://api.openai.com"
	// model is fixed on the server; callers never choose it.
	model          = "gpt-5-mini"
	requestTimeout = 20 * time.Second
	maxRespBody    = 1 << 20
)

// Result is a validated generation: the corrected or translated text, its
// pinyin, and 1-5 Japanese learning hints.
type Result struct {
	Text, Pinyin string
	Hints        []string
}

// Error is a generation failure. Its string is only the Code, so it never
// carries the API key, the input text or the response body. Retryable is set
// only for timeouts, transport failures and 5xx responses.
type Error struct {
	Code      string
	Retryable bool
}

func (e *Error) Error() string { return e.Code }

func newError(code string, retryable bool) *Error {
	return &Error{Code: code, Retryable: retryable}
}

// OpenAI calls the OpenAI Responses API. HTTP should be set by main; nil uses a
// client with a timeout. BaseURL defaults to https://api.openai.com and may end
// with a slash.
type OpenAI struct {
	HTTP    *http.Client
	BaseURL string
	APIKey  string
}

// Generate asks OpenAI for a correction or translation of text and returns the
// validated result. Failures are *Error.
func (o *OpenAI) Generate(ctx context.Context, kind, text string) (Result, error) {
	spec, ok := specs[kind]
	if !ok {
		return Result{}, newError("OPENAI_REQUEST_FAILED", false)
	}
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	payload, err := json.Marshal(map[string]any{
		"model":             model,
		"instructions":      spec.instructions,
		"input":             text,
		"store":             false,
		"max_output_tokens": 4000,
		"reasoning":         map[string]any{"effort": "minimal"},
		"text": map[string]any{"format": map[string]any{
			"type":   "json_schema",
			"name":   spec.schemaName,
			"strict": true,
			"schema": spec.jsonSchema(),
		}},
	})
	if err != nil {
		return Result{}, newError("OPENAI_REQUEST_FAILED", false)
	}
	base := o.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/v1/responses", bytes.NewReader(payload))
	if err != nil {
		return Result{}, newError("OPENAI_REQUEST_FAILED", false)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+o.APIKey)

	resp, err := o.client().Do(req)
	if err != nil {
		return Result{}, transportError(ctx, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		switch resp.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return Result{}, newError("OPENAI_AUTH_FAILED", false)
		case http.StatusTooManyRequests:
			return Result{}, newError("OPENAI_RATE_LIMITED", false)
		}
		// Only 5xx may succeed on a later attempt; other 4xx are our fault.
		return Result{}, newError("OPENAI_REQUEST_FAILED", resp.StatusCode >= 500)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRespBody+1))
	if err != nil {
		return Result{}, transportError(ctx, err)
	}
	if len(body) > maxRespBody {
		return Result{}, newError("OPENAI_INVALID_RESPONSE", false)
	}
	out, ok := outputText(body)
	if !ok {
		return Result{}, newError("OPENAI_INVALID_RESPONSE", false)
	}
	res, err := spec.parse(out)
	if err != nil {
		return Result{}, newError("OPENAI_INVALID_RESPONSE", false)
	}
	return res, nil
}

// client returns the caller's client with redirects disabled (the request
// carries the API key), or a default one with a timeout.
func (o *OpenAI) client() *http.Client {
	c := &http.Client{Timeout: requestTimeout}
	if o.HTTP != nil {
		copied := *o.HTTP
		c = &copied
	}
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return c
}

// transportError maps a failed round trip: any deadline is a timeout, everything
// else (including cancellation) is a request failure; both are retryable.
func transportError(ctx context.Context, err error) *Error {
	var ne net.Error
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) ||
		(errors.As(err, &ne) && ne.Timeout()) {
		return newError("OPENAI_TIMEOUT", true)
	}
	return newError("OPENAI_REQUEST_FAILED", true)
}

// outputText concatenates the output_text parts of a completed Responses API
// body. A refusal, an incomplete status or no text at all reports false.
func outputText(body []byte) (string, bool) {
	var payload struct {
		Status string `json:"status"`
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Status != "completed" {
		return "", false
	}
	var sb strings.Builder
	for _, item := range payload.Output {
		if item.Type != "message" {
			continue
		}
		for _, c := range item.Content {
			switch c.Type {
			case "refusal":
				return "", false
			case "output_text":
				sb.WriteString(c.Text)
			}
		}
	}
	return sb.String(), sb.Len() > 0
}
