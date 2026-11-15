// Package learning generates Chinese-learning material (a correction or a
// translation, with pinyin and hints) from a user's text through OpenAI.
package learning

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/openai"
)

const (
	// KindCorrection corrects a Chinese sentence; KindTranslation turns
	// Japanese into Chinese.
	KindCorrection  = "correction"
	KindTranslation = "translation"

	// DefaultModel is the model used when OpenAI.Model is empty. The model is
	// set on the server (OPENAI_LEARNING_MODEL); callers never choose it.
	DefaultModel   = "gpt-5-mini"
	requestTimeout = 20 * time.Second
	maxRespBody    = 1 << 20
)

// Result is a validated generation: the corrected or translated text, its
// pinyin, and 1-5 Japanese learning hints.
type Result struct {
	Text, Pinyin string
	Hints        []string
}

// Error is a generation failure (an *openai.Error). Its string is only the
// Code, so it never carries the API key, the input text or the response body.
// Retryable is set only for timeouts, transport failures and 5xx responses.
type Error = openai.Error

// OpenAI calls the OpenAI Responses API. HTTP should be set by main; nil uses a
// client with a timeout. BaseURL defaults to https://api.openai.com and may end
// with a slash.
type OpenAI struct {
	HTTP    *http.Client
	BaseURL string
	APIKey  string
	// Model defaults to DefaultModel.
	Model string
}

func (o *OpenAI) model() string {
	if o.Model == "" {
		return DefaultModel
	}
	return o.Model
}

// Generate asks OpenAI for a correction or translation of text and returns the
// validated result. Failures are *Error.
func (o *OpenAI) Generate(ctx context.Context, kind, text string) (Result, error) {
	spec, ok := specs[kind]
	if !ok {
		return Result{}, openai.Fail(openai.CodeRequestFailed)
	}
	out, err := o.respond(ctx, spec.instructions, spec.schemaName, spec.jsonSchema(), text)
	if err != nil {
		return Result{}, err
	}
	res, err := spec.parse(out)
	if err != nil {
		return Result{}, openai.Fail(openai.CodeInvalidResponse)
	}
	return res, nil
}

// respond sends input with instructions and a strict JSON schema, and returns
// the model's JSON text. Failures are *Error.
func (o *OpenAI) respond(ctx context.Context, instructions, schemaName string, schema map[string]any, input string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	model := o.model()
	resp, err := openai.Request{
		HTTP: o.HTTP, DefaultTimeout: requestTimeout, BaseURL: o.BaseURL, APIKey: o.APIKey,
	}.Post(ctx, map[string]any{
		"model":             model,
		"instructions":      instructions,
		"input":             input,
		"store":             false,
		"max_output_tokens": 4000,
		"reasoning":         map[string]any{"effort": "minimal"},
		"text": map[string]any{"format": map[string]any{
			"type":   "json_schema",
			"name":   schemaName,
			"strict": true,
			"schema": schema,
		}},
	})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRespBody+1))
	if err != nil {
		return "", openai.TransportError(ctx, err)
	}
	if len(body) > maxRespBody {
		return "", openai.Fail(openai.CodeInvalidResponse)
	}
	// The tokens are spent even when the answer turns out unusable.
	openai.ReportBodyUsage(ctx, model, body)
	out, ok := outputText(body)
	if !ok {
		return "", openai.Fail(openai.CodeInvalidResponse)
	}
	return out, nil
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
