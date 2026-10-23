package main

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

const minJWTSecretBytes = 32

const (
	defaultOpenAIBaseURL  = "https://api.openai.com"
	defaultLineAPIBaseURL = "https://api.line.me"
)

// Config holds the API server settings read from the environment.
type Config struct {
	Port               string
	DatabaseURL        string
	JWTSecret          []byte
	GitHubClientID     string
	GitHubClientSecret string
	GitHubRedirectURI  string
	// The web OAuth App is optional: all three values are set, or none.
	GitHubWebClientID     string
	GitHubWebClientSecret string
	GitHubWebRedirectURI  string
	// WebProxySecret is optional: the secret the Next.js web server presents
	// so the API trusts the end-user IP it forwards.
	WebProxySecret   []byte
	AllowedGitHubIDs string // comma-separated numeric GitHub user IDs of admins
	// The LINE bot is optional: all three values are set, or none.
	LineChannelSecret      []byte
	LineChannelAccessToken string
	OpenAIAPIKey           string
	// CronSecret is optional: the bearer secret the scheduler presents to the
	// LINE retry endpoint. Unset means that endpoint always answers 401.
	CronSecret []byte
	// Upstream base URLs. Only loopback overrides are accepted (for tests).
	OpenAIBaseURL  string
	LineAPIBaseURL string
}

// LineEnabled reports whether the LINE webhook routes should be registered.
func (c Config) LineEnabled() bool {
	return len(c.LineChannelSecret) > 0
}

// LoadConfig reads and validates the configuration. Secret values are never
// included in error messages.
func LoadConfig(getenv func(string) string) (Config, error) {
	get := func(name string) string { return strings.TrimSpace(getenv(name)) }

	required := func(name string) (string, error) {
		value := get(name)
		if value == "" {
			return "", fmt.Errorf("%s is required", name)
		}
		return value, nil
	}

	var cfg Config
	var err error

	cfg.Port = get("PORT")
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.DatabaseURL, err = required("DATABASE_URL"); err != nil {
		return Config{}, err
	}
	secret, err := required("API_JWT_SECRET")
	if err != nil {
		return Config{}, err
	}
	if len(secret) < minJWTSecretBytes {
		return Config{}, fmt.Errorf("API_JWT_SECRET must be at least %d bytes", minJWTSecretBytes)
	}
	cfg.JWTSecret = []byte(secret)
	if cfg.GitHubClientID, err = required("GITHUB_MOBILE_CLIENT_ID"); err != nil {
		return Config{}, err
	}
	if cfg.GitHubClientSecret, err = required("GITHUB_MOBILE_CLIENT_SECRET"); err != nil {
		return Config{}, err
	}
	if cfg.GitHubRedirectURI, err = required("GITHUB_MOBILE_REDIRECT_URI"); err != nil {
		return Config{}, err
	}
	cfg.GitHubWebClientID = get("GITHUB_WEB_CLIENT_ID")
	cfg.GitHubWebClientSecret = get("GITHUB_WEB_CLIENT_SECRET")
	cfg.GitHubWebRedirectURI = get("GITHUB_WEB_REDIRECT_URI")
	webSet := 0
	for _, v := range []string{cfg.GitHubWebClientID, cfg.GitHubWebClientSecret, cfg.GitHubWebRedirectURI} {
		if v != "" {
			webSet++
		}
	}
	if webSet != 0 && webSet != 3 {
		return Config{}, errors.New("GITHUB_WEB_CLIENT_ID, GITHUB_WEB_CLIENT_SECRET and GITHUB_WEB_REDIRECT_URI must be set together")
	}
	// The OAuth App is picked by redirect URI, so the two must not collide.
	if cfg.GitHubWebRedirectURI != "" && cfg.GitHubWebRedirectURI == cfg.GitHubRedirectURI {
		return Config{}, errors.New("GITHUB_WEB_REDIRECT_URI must differ from GITHUB_MOBILE_REDIRECT_URI")
	}
	if proxySecret := get("API_WEB_PROXY_SECRET"); proxySecret != "" {
		if len(proxySecret) < minJWTSecretBytes {
			return Config{}, fmt.Errorf("API_WEB_PROXY_SECRET must be at least %d bytes", minJWTSecretBytes)
		}
		cfg.WebProxySecret = []byte(proxySecret)
	}
	if cfg.AllowedGitHubIDs, err = required("AUTH_ALLOWED_GITHUB_IDS"); err != nil {
		return Config{}, err
	}
	lineSecret := get("LINE_CHANNEL_SECRET")
	cfg.LineChannelAccessToken = get("LINE_CHANNEL_ACCESS_TOKEN")
	cfg.OpenAIAPIKey = get("OPENAI_API_KEY")
	lineSet := 0
	for _, v := range []string{lineSecret, cfg.LineChannelAccessToken, cfg.OpenAIAPIKey} {
		if v != "" {
			lineSet++
		}
	}
	if lineSet != 0 && lineSet != 3 {
		return Config{}, errors.New("LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN and OPENAI_API_KEY must be set together")
	}
	if lineSecret != "" {
		cfg.LineChannelSecret = []byte(lineSecret)
	}
	if cronSecret := get("CRON_SECRET"); cronSecret != "" {
		cfg.CronSecret = []byte(cronSecret)
	}
	if cfg.OpenAIBaseURL, err = baseURL(get, "OPENAI_API_BASE_URL", defaultOpenAIBaseURL); err != nil {
		return Config{}, err
	}
	if cfg.LineAPIBaseURL, err = baseURL(get, "LINE_API_BASE_URL", defaultLineAPIBaseURL); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// baseURL returns the named override, or def when unset. An override must be a
// loopback URL so the API cannot be pointed at an arbitrary host. The value is
// left out of the error message.
func baseURL(get func(string) string, name, def string) (string, error) {
	value := get(name)
	if value == "" {
		return def, nil
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return "", fmt.Errorf("%s must be an http(s) loopback URL", name)
	}
	switch u.Hostname() {
	case "127.0.0.1", "::1", "localhost":
		return value, nil
	}
	return "", fmt.Errorf("%s must be an http(s) loopback URL", name)
}
