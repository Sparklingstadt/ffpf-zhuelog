package line

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	defaultBaseURL = "https://api.line.me"
	maxBody        = 1 << 20
	// maxMessagesPerCall is the Messaging API limit for one reply or push.
	maxMessagesPerCall = 5
)

// Client sends messages through the LINE Messaging API. HTTP should carry a
// timeout; main sets it. Errors never contain the access token, the reply token,
// the recipient or the message text.
type Client struct {
	HTTP        *http.Client
	BaseURL     string // default https://api.line.me; a trailing slash is fine
	AccessToken string
}

type textMessage struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// Reply answers an event using its reply token (valid once, for about a minute).
func (c *Client) Reply(ctx context.Context, replyToken string, texts ...string) error {
	return c.send(ctx, "/v2/bot/message/reply", map[string]any{"replyToken": replyToken}, texts)
}

// Push sends texts to a LINE user ID without a reply token.
func (c *Client) Push(ctx context.Context, to string, texts ...string) error {
	return c.send(ctx, "/v2/bot/message/push", map[string]any{"to": to}, texts)
}

func (c *Client) send(ctx context.Context, path string, fields map[string]any, texts []string) error {
	if len(texts) == 0 || len(texts) > maxMessagesPerCall {
		return errors.New("line: message count must be between 1 and 5")
	}
	msgs := make([]textMessage, len(texts))
	for i, t := range texts {
		msgs[i] = textMessage{Type: "text", Text: t}
	}
	fields["messages"] = msgs
	payload, err := json.Marshal(fields)
	if err != nil {
		return errors.New("line: encode request failed")
	}

	base := c.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+path, bytes.NewReader(payload))
	if err != nil {
		return errors.New("line: build request failed")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AccessToken)

	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		// The transport error is dropped on purpose: it can embed request details.
		return errors.New("line: request failed")
	}
	defer resp.Body.Close()
	// Drain (bounded) so the connection can be reused; the body is never surfaced.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxBody))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("line: api returned status %d", resp.StatusCode)
	}
	return nil
}
