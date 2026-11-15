// Package openai is the transport shared by the calls to the OpenAI
// Responses API: the POST to /v1/responses, the mapping of failures to
// Error codes, and the reporting of token usage.
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/aiusage"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/httpclient"
)

// DefaultBaseURL is where the API is unless a caller names another.
const DefaultBaseURL = "https://api.openai.com"

// Error codes.
const (
	CodeRequestFailed      = "OPENAI_REQUEST_FAILED"
	CodeAuthFailed         = "OPENAI_AUTH_FAILED"
	CodeRateLimited        = "OPENAI_RATE_LIMITED"
	CodeTimeout            = "OPENAI_TIMEOUT"
	CodeInvalidResponse    = "OPENAI_INVALID_RESPONSE"
	CodeIncompleteResponse = "OPENAI_INCOMPLETE_RESPONSE"
)

// Error is a failed call. Its string is only the Code, so it never carries
// the API key, the input or the response body. Retryable is set only for
// timeouts, transport failures and 5xx responses.
type Error struct {
	Code      string
	Retryable bool
}

func (e *Error) Error() string { return e.Code }

// Fail is a non-retryable *Error with code.
func Fail(code string) *Error { return &Error{Code: code} }

// Request is one POST to /v1/responses. HTTP is the caller's client (nil
// uses a new one with DefaultTimeout); redirects are never followed, since
// the request carries the API key. BaseURL defaults to DefaultBaseURL and may
// end with a slash. Accept, when set, is sent as the Accept header.
type Request struct {
	HTTP           *http.Client
	DefaultTimeout time.Duration
	BaseURL        string
	APIKey         string
	Accept         string
}

// Post sends payload as JSON and returns the 200 response, whose body the
// caller closes. Any other outcome is an *Error: 401 and 403 are
// OPENAI_AUTH_FAILED, 429 OPENAI_RATE_LIMITED and other statuses
// OPENAI_REQUEST_FAILED (retryable for 5xx); a failed round trip is
// TransportError's.
func (r Request) Post(ctx context.Context, payload any) (*http.Response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, Fail(CodeRequestFailed)
	}
	base := r.BaseURL
	if base == "" {
		base = DefaultBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/v1/responses", bytes.NewReader(body))
	if err != nil {
		return nil, Fail(CodeRequestFailed)
	}
	req.Header.Set("Content-Type", "application/json")
	if r.Accept != "" {
		req.Header.Set("Accept", r.Accept)
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)

	resp, err := httpclient.NoRedirect(r.HTTP, r.DefaultTimeout).Do(req)
	if err != nil {
		return nil, TransportError(ctx, err)
	}
	if resp.StatusCode == http.StatusOK {
		return resp, nil
	}
	resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, Fail(CodeAuthFailed)
	case http.StatusTooManyRequests:
		return nil, Fail(CodeRateLimited)
	}
	// Only 5xx may succeed on a later attempt; other 4xx are our fault.
	return nil, &Error{Code: CodeRequestFailed, Retryable: resp.StatusCode >= 500}
}

// TransportError maps a failed round trip or read: any deadline is a
// timeout, everything else (including cancellation) is a request failure;
// both are retryable.
func TransportError(ctx context.Context, err error) *Error {
	var ne net.Error
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) ||
		(errors.As(err, &ne) && ne.Timeout()) {
		return &Error{Code: CodeTimeout, Retryable: true}
	}
	return &Error{Code: CodeRequestFailed, Retryable: true}
}

// Usage is the token counts of a response.
type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// ReportUsage passes u, spent on model, to the context's aiusage.Recorder.
// A nil u reports nothing.
func ReportUsage(ctx context.Context, model string, u *Usage) {
	if u == nil {
		return
	}
	aiusage.Report(ctx, aiusage.Usage{Model: model, InputTokens: u.InputTokens, OutputTokens: u.OutputTokens})
}

// ReportBodyUsage is ReportUsage for the "usage" of a whole Responses API
// body. A body without usage reports nothing.
func ReportBodyUsage(ctx context.Context, model string, body []byte) {
	var payload struct {
		Usage *Usage `json:"usage"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return
	}
	ReportUsage(ctx, model, payload.Usage)
}
