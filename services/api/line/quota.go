package line

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Quota is this month's push allowance of the channel. Unlimited channels
// (paid plans without a cap) report Unlimited and no Remaining.
type Quota struct {
	Unlimited bool
	Remaining int
}

// PushQuota reads the month's message limit and what has been used of it.
// Replies are free and not counted; pushes are.
func (c *Client) PushQuota(ctx context.Context) (Quota, error) {
	var limit struct {
		Type  string `json:"type"`
		Value int    `json:"value"`
	}
	if err := c.get(ctx, "/v2/bot/message/quota", &limit); err != nil {
		return Quota{}, err
	}
	switch limit.Type {
	case "none":
		return Quota{Unlimited: true}, nil
	case "limited":
	default:
		return Quota{}, errors.New("line: unknown quota type")
	}
	var used struct {
		TotalUsage *int `json:"totalUsage"`
	}
	if err := c.get(ctx, "/v2/bot/message/quota/consumption", &used); err != nil {
		return Quota{}, err
	}
	if used.TotalUsage == nil {
		return Quota{}, errors.New("line: quota consumption missing")
	}
	return Quota{Remaining: max(limit.Value-*used.TotalUsage, 0)}, nil
}

// get reads a JSON body from the Messaging API into out.
func (c *Client) get(ctx context.Context, path string, out any) error {
	base := c.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+path, nil)
	if err != nil {
		return errors.New("line: build request failed")
	}
	req.Header.Set("Authorization", "Bearer "+c.AccessToken)
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("line: request failed")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return errors.New("line: read response failed")
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("line: api returned status %d", resp.StatusCode)
	}
	if json.Unmarshal(body, out) != nil {
		return errors.New("line: invalid response")
	}
	return nil
}
