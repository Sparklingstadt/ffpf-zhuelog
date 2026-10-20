package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultGitHubTokenURL = "https://github.com/login/oauth/access_token"
	defaultGitHubAPIURL   = "https://api.github.com"
	githubMaxBody         = 1 << 20
)

// ErrGitHubUnavailable means GitHub could not be reached or returned something
// unusable (network error, timeout, 5xx, malformed JSON).
var ErrGitHubUnavailable = errors.New("auth: github unavailable")

// GitHubUser is the subset of GitHub's /user response the API needs.
type GitHubUser struct {
	ID    int64
	Login string
}

// GitHubClient exchanges a mobile app's OAuth code (PKCE) for the GitHub user.
// HTTP should carry a 10s timeout; main sets it.
type GitHubClient struct {
	HTTP                                *http.Client
	ClientID, ClientSecret, RedirectURI string
	TokenURL                            string // default https://github.com/login/oauth/access_token
	APIURL                              string // default https://api.github.com
}

// Exchange trades code+verifier for a GitHub access token and returns the
// authenticated user. It returns ErrUnauthorized when the code, verifier or
// redirect URI is rejected, and ErrGitHubUnavailable for transport and
// upstream failures. Returned errors never contain the code, verifier, client
// secret or GitHub token.
func (g *GitHubClient) Exchange(ctx context.Context, code, verifier, redirectURI string) (GitHubUser, error) {
	if code == "" || verifier == "" || redirectURI != g.RedirectURI {
		return GitHubUser{}, ErrUnauthorized
	}
	token, err := g.fetchToken(ctx, code, verifier, redirectURI)
	if err != nil {
		return GitHubUser{}, err
	}
	return g.fetchUser(ctx, token)
}

func (g *GitHubClient) fetchToken(ctx context.Context, code, verifier, redirectURI string) (string, error) {
	tokenURL := g.TokenURL
	if tokenURL == "" {
		tokenURL = defaultGitHubTokenURL
	}
	form := url.Values{
		"client_id":     {g.ClientID},
		"client_secret": {g.ClientSecret},
		"code":          {code},
		"code_verifier": {verifier},
		"redirect_uri":  {redirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", ErrGitHubUnavailable
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	status, body, err := g.do(req)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", ErrGitHubUnavailable
	}
	var out struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", ErrGitHubUnavailable
	}
	if out.Error != "" {
		return "", ErrUnauthorized
	}
	if out.AccessToken == "" {
		return "", ErrGitHubUnavailable
	}
	return out.AccessToken, nil
}

func (g *GitHubClient) fetchUser(ctx context.Context, token string) (GitHubUser, error) {
	apiURL := g.APIURL
	if apiURL == "" {
		apiURL = defaultGitHubAPIURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(apiURL, "/")+"/user", nil)
	if err != nil {
		return GitHubUser{}, ErrGitHubUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	status, body, err := g.do(req)
	if err != nil {
		return GitHubUser{}, err
	}
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return GitHubUser{}, ErrUnauthorized
	case status < 200 || status > 299:
		return GitHubUser{}, ErrGitHubUnavailable
	}
	var out struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.ID <= 0 || out.Login == "" {
		return GitHubUser{}, ErrGitHubUnavailable
	}
	return GitHubUser{ID: out.ID, Login: out.Login}, nil
}

// do sends req and returns the status and (size-limited) body. The underlying
// transport error is deliberately dropped: it can embed request details.
func (g *GitHubClient) do(req *http.Request) (int, []byte, error) {
	client := g.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, ErrGitHubUnavailable
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, githubMaxBody))
	if err != nil {
		return 0, nil, ErrGitHubUnavailable
	}
	return resp.StatusCode, body, nil
}
