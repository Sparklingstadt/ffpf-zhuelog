package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode"
)

const githubEndpoint = "https://api.github.com/repos/Sparklingstadt/ffpf-zhuelog/issues"

var issueURL = regexp.MustCompile(`^https://github\.com/Sparklingstadt/ffpf-zhuelog/issues/[1-9]\d*$`)

type issueResult struct {
	Outcome string `json:"outcome"`
	URL     string `json:"url,omitempty"`
}
type issueDraft struct {
	Title  string `json:"title"`
	Body   string `json:"body"`
	Marker string `json:"-"`
}

func makeIssue(id, text string) (issueDraft, error) {
	if !safeID.MatchString(id) || strings.TrimSpace(text) == "" || jsLen(text) > 500 {
		return issueDraft{}, errors.New("invalid issue input")
	}
	text = strings.Map(func(r rune) rune {
		if (r < 32 && r != '\t' && r != '\n' && r != '\r') || r == 127 {
			return -1
		}
		return r
	}, text)
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	title := strings.ReplaceAll(lines[0], "@", "＠")
	// Respect the JS UTF-16 budget without splitting an emoji surrogate pair.
	short := ""
	for _, r := range title {
		if jsLen(short+string(r)) > 80 {
			break
		}
		short += string(r)
	}
	for i := range lines {
		lines[i] = "    " + lines[i]
	}
	marker := "<!-- zhuelog-dev:" + id + " -->"
	return issueDraft{Title: "[改善案] " + short, Body: "## 仕様改善案\n\n" + strings.Join(lines, "\n") + "\n\n---\nLINE開発モードから登録。内容は投稿者の原文です（AIによる補完なし）。\n" + marker, Marker: marker}, nil
}

type githubIssue struct {
	URL  string          `json:"html_url"`
	Body *string         `json:"body"`
	PR   json.RawMessage `json:"pull_request"`
}
type githubClient struct {
	token    string
	client   *http.Client
	endpoint string
}

func (g githubClient) request(ctx context.Context, method, url string, body, out any) error {
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Content-Type", "application/json")
	r, err := g.client.Do(req)
	if err != nil {
		return errors.New("GitHub request failed")
	}
	defer r.Body.Close()
	if r.StatusCode < 200 || r.StatusCode >= 300 {
		return errors.New("GitHub HTTP error")
	}
	return readJSON(r.Body, 16*1024*1024, out)
}
func createdIssue(url string) (*issueResult, error) {
	if !issueURL.MatchString(url) {
		return nil, errors.New("unexpected issue URL")
	}
	return &issueResult{Outcome: "created", URL: url}, nil
}
func (g githubClient) find(ctx context.Context, marker string) (*issueResult, error) {
	for page := 1; page <= 10; page++ {
		var issues []githubIssue
		url := fmt.Sprintf("%s?state=all&sort=created&direction=desc&per_page=100&page=%d", g.endpoint, page)
		if err := g.request(ctx, "GET", url, nil, &issues); err != nil {
			return nil, err
		}
		if issues == nil || len(issues) > 100 {
			return nil, errors.New("invalid issue list")
		}
		for _, issue := range issues {
			if (len(issue.PR) == 0 || string(issue.PR) == "null") && issue.Body != nil && strings.HasSuffix(*issue.Body, marker) {
				return createdIssue(issue.URL)
			}
		}
		if len(issues) < 100 {
			return nil, nil
		}
	}
	return nil, errors.New("issue scan limit")
}
func (g githubClient) publish(ctx context.Context, j job, permit func() (*bool, error)) (*issueResult, error) {
	draft, err := makeIssue(j.ID, j.OriginalText)
	if err != nil {
		return nil, err
	}
	deadline, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	uncertain := func() (*issueResult, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return &issueResult{Outcome: "uncertain"}, nil
	}
	existing, err := g.find(deadline, draft.Marker)
	if err != nil {
		return uncertain()
	}
	if existing != nil {
		return existing, nil
	}
	allowed, err := permit()
	if err != nil {
		return uncertain()
	}
	if allowed == nil {
		return nil, nil
	} // Lost lease: neither publish nor complete.
	if !*allowed {
		return uncertain()
	}
	var result githubIssue
	if err = g.request(deadline, "POST", g.endpoint, draft, &result); err == nil {
		if created, err := createdIssue(result.URL); err == nil {
			return created, nil
		}
	}
	// Never repeat POST after timeout / uncertain publication. Reconcile by marker only.
	if existing, err := g.find(deadline, draft.Marker); err == nil && existing != nil {
		return existing, nil
	}
	return uncertain()
}
func publishLocal(ctx context.Context, bin string, j job, permit func() (*bool, error)) (*issueResult, error) {
	deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
	token, err := boundedCommand(deadline, bin, []string{"auth", "token", "--hostname", "github.com"}, []string{"HOME=" + os.Getenv("HOME"), "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "GH_PROMPT_DISABLED=1", "GH_HOST=github.com", "NODE_ENV=development"}, 8192)
	cancel()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	token = strings.TrimSpace(token)
	if err != nil || token == "" || strings.ContainsFunc(token, unicode.IsSpace) {
		return &issueResult{Outcome: "unavailable"}, nil
	}
	g := githubClient{token: token, client: newHTTPClient(), endpoint: githubEndpoint}
	return g.publish(ctx, j, permit)
}
