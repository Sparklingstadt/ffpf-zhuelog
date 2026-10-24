package main

import (
	"strings"
	"testing"
)

var requiredEnv = []string{
	"DATABASE_URL",
	"API_JWT_SECRET",
	"GITHUB_MOBILE_CLIENT_ID",
	"GITHUB_MOBILE_CLIENT_SECRET",
	"GITHUB_MOBILE_REDIRECT_URI",
	"AUTH_ALLOWED_GITHUB_IDS",
}

func validEnv() map[string]string {
	return map[string]string{
		"DATABASE_URL":                "postgresql://u:p@localhost:5432/db",
		"API_JWT_SECRET":              strings.Repeat("s", 32),
		"GITHUB_MOBILE_CLIENT_ID":     "client-id",
		"GITHUB_MOBILE_CLIENT_SECRET": "client-secret-value",
		"GITHUB_MOBILE_REDIRECT_URI":  "zhuelog://auth/callback",
		"AUTH_ALLOWED_GITHUB_IDS":     "583231",
	}
}

func getenvFrom(env map[string]string) func(string) string {
	return func(key string) string { return env[key] }
}

func TestLoadConfigDefaults(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want 8080", cfg.Port)
	}
	if cfg.DatabaseURL != "postgresql://u:p@localhost:5432/db" {
		t.Errorf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if len(cfg.JWTSecret) != 32 {
		t.Errorf("len(JWTSecret) = %d, want 32", len(cfg.JWTSecret))
	}
	if cfg.GitHubClientID != "client-id" || cfg.GitHubClientSecret != "client-secret-value" ||
		cfg.GitHubRedirectURI != "zhuelog://auth/callback" || cfg.AllowedGitHubIDs != "583231" {
		t.Errorf("unexpected config: %+v", cfg)
	}
}

func TestLoadConfigMissing(t *testing.T) {
	for _, name := range requiredEnv {
		t.Run(name, func(t *testing.T) {
			env := validEnv()
			env[name] = "  "
			_, err := LoadConfig(getenvFrom(env))
			if err == nil {
				t.Fatalf("expected error when %s is empty", name)
			}
			if !strings.Contains(err.Error(), name) {
				t.Errorf("error %q does not mention %s", err, name)
			}
		})
	}
}

func TestLoadConfigShortSecret(t *testing.T) {
	env := validEnv()
	secret := strings.Repeat("x", 31)
	env["API_JWT_SECRET"] = secret
	_, err := LoadConfig(getenvFrom(env))
	if err == nil {
		t.Fatal("expected error for 31-byte secret")
	}
	if !strings.Contains(err.Error(), "API_JWT_SECRET") {
		t.Errorf("error %q does not mention API_JWT_SECRET", err)
	}
	if strings.Contains(err.Error(), secret) {
		t.Error("error leaks the secret value")
	}
}

func TestLoadConfigGitHubWebAllOrNone(t *testing.T) {
	web := map[string]string{
		"GITHUB_WEB_CLIENT_ID":     "web-id",
		"GITHUB_WEB_CLIENT_SECRET": "web-secret-value",
		"GITHUB_WEB_REDIRECT_URI":  "https://zhuelog.example/api/auth/callback",
	}
	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("none set: %v", err)
	}
	if cfg.GitHubWebClientID != "" || cfg.GitHubWebClientSecret != "" || cfg.GitHubWebRedirectURI != "" {
		t.Errorf("web fields should be empty: %+v", cfg)
	}

	env := validEnv()
	for k, v := range web {
		env[k] = v
	}
	cfg, err = LoadConfig(getenvFrom(env))
	if err != nil {
		t.Fatalf("all set: %v", err)
	}
	if cfg.GitHubWebClientID != "web-id" || cfg.GitHubWebClientSecret != "web-secret-value" ||
		cfg.GitHubWebRedirectURI != web["GITHUB_WEB_REDIRECT_URI"] {
		t.Errorf("unexpected web config: %+v", cfg)
	}

	for missing := range web {
		env := validEnv()
		for k, v := range web {
			if k != missing {
				env[k] = v
			}
		}
		_, err := LoadConfig(getenvFrom(env))
		want := "GITHUB_WEB_CLIENT_ID, GITHUB_WEB_CLIENT_SECRET and GITHUB_WEB_REDIRECT_URI must be set together"
		if err == nil || err.Error() != want {
			t.Errorf("missing %s: err = %v, want %q", missing, err, want)
		}
	}
}

func TestLoadConfigGitHubWebRedirectMustDiffer(t *testing.T) {
	env := validEnv()
	env["GITHUB_WEB_CLIENT_ID"] = "web-id"
	env["GITHUB_WEB_CLIENT_SECRET"] = "web-secret-value"
	env["GITHUB_WEB_REDIRECT_URI"] = env["GITHUB_MOBILE_REDIRECT_URI"]
	_, err := LoadConfig(getenvFrom(env))
	want := "GITHUB_WEB_REDIRECT_URI must differ from GITHUB_MOBILE_REDIRECT_URI"
	if err == nil || err.Error() != want {
		t.Fatalf("err = %v, want %q", err, want)
	}
}

func TestLoadConfigWebProxySecret(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil || len(cfg.WebProxySecret) != 0 {
		t.Fatalf("unset: err = %v, secret len = %d, want none", err, len(cfg.WebProxySecret))
	}

	env := validEnv()
	env["API_WEB_PROXY_SECRET"] = "  " + strings.Repeat("p", 32) + "  "
	cfg, err = LoadConfig(getenvFrom(env))
	if err != nil || string(cfg.WebProxySecret) != strings.Repeat("p", 32) {
		t.Fatalf("32 bytes: err = %v, want trimmed secret accepted", err)
	}

	env["API_WEB_PROXY_SECRET"] = strings.Repeat("p", 31)
	_, err = LoadConfig(getenvFrom(env))
	if err == nil || err.Error() != "API_WEB_PROXY_SECRET must be at least 32 bytes" {
		t.Fatalf("31 bytes: err = %v, want the length error", err)
	}
	if strings.Contains(err.Error(), env["API_WEB_PROXY_SECRET"]) {
		t.Fatal("error leaks the secret value")
	}
}

var lineEnv = []string{"LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "OPENAI_API_KEY"}

func TestLoadConfigLineAllOrNothing(t *testing.T) {
	const secretValue = "line-secret-value-xyz"

	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.LineEnabled() {
		t.Error("LineEnabled() = true with none set")
	}

	// Every proper, non-empty subset of the three must be rejected.
	for mask := 1; mask < 7; mask++ {
		env := validEnv()
		for i, name := range lineEnv {
			if mask&(1<<i) != 0 {
				env[name] = secretValue
			}
		}
		if env["LINE_CHANNEL_SECRET"] == "" && env["LINE_CHANNEL_ACCESS_TOKEN"] == "" {
			continue // OPENAI_API_KEY alone enables the chat only; see TestLoadConfigOpenAIAloneEnablesChatNotLine
		}
		_, err := LoadConfig(getenvFrom(env))
		if err == nil {
			t.Fatalf("mask %03b: expected error for partial LINE config", mask)
		}
		for _, name := range lineEnv {
			if !strings.Contains(err.Error(), name) {
				t.Errorf("mask %03b: error %q does not mention %s", mask, err, name)
			}
		}
		if strings.Contains(err.Error(), secretValue) {
			t.Errorf("mask %03b: error leaks a secret value", mask)
		}
	}

	env := validEnv()
	env["LINE_CHANNEL_SECRET"] = "channel-secret"
	env["LINE_CHANNEL_ACCESS_TOKEN"] = "access-token"
	env["OPENAI_API_KEY"] = "openai-key"
	cfg, err = LoadConfig(getenvFrom(env))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if !cfg.LineEnabled() {
		t.Error("LineEnabled() = false with all three set")
	}
	if string(cfg.LineChannelSecret) != "channel-secret" || cfg.LineChannelAccessToken != "access-token" || cfg.OpenAIAPIKey != "openai-key" {
		t.Errorf("unexpected LINE config: %+v", cfg)
	}
}

func TestLoadConfigBaseURLDefaults(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.OpenAIBaseURL != "https://api.openai.com" {
		t.Errorf("OpenAIBaseURL = %q", cfg.OpenAIBaseURL)
	}
	if cfg.LineAPIBaseURL != "https://api.line.me" {
		t.Errorf("LineAPIBaseURL = %q", cfg.LineAPIBaseURL)
	}
}

func TestLoadConfigBaseURLLoopbackOnly(t *testing.T) {
	for _, name := range []string{"OPENAI_API_BASE_URL", "LINE_API_BASE_URL"} {
		for _, ok := range []string{
			"http://127.0.0.1:9999",
			"http://localhost:8080",
			"http://[::1]:9999",
			"https://localhost",
		} {
			t.Run(name+"/"+ok, func(t *testing.T) {
				env := validEnv()
				env[name] = ok
				cfg, err := LoadConfig(getenvFrom(env))
				if err != nil {
					t.Fatalf("LoadConfig: %v", err)
				}
				got := cfg.OpenAIBaseURL
				if name == "LINE_API_BASE_URL" {
					got = cfg.LineAPIBaseURL
				}
				if got != ok {
					t.Errorf("base URL = %q, want %q", got, ok)
				}
			})
		}
		for _, bad := range []string{
			"https://example.com",
			"http://127.0.0.1.example.com",
			"http://localhost.evil.com",
			"http://user@evil.com",
			"http://10.0.0.1",
			"not a url",
			"127.0.0.1:9999",
		} {
			t.Run(name+"/"+bad, func(t *testing.T) {
				env := validEnv()
				env[name] = bad
				_, err := LoadConfig(getenvFrom(env))
				if err == nil {
					t.Fatalf("expected error for %s=%q", name, bad)
				}
				if !strings.Contains(err.Error(), name) {
					t.Errorf("error %q does not mention %s", err, name)
				}
			})
		}
	}
}

func TestLoadConfigCronSecretOptional(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.CronSecret != nil {
		t.Errorf("CronSecret = %q, want nil when unset", cfg.CronSecret)
	}

	env := validEnv()
	env["CRON_SECRET"] = "  "
	cfg, err = LoadConfig(getenvFrom(env))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.CronSecret != nil {
		t.Errorf("CronSecret = %q, want nil when blank", cfg.CronSecret)
	}

	env["CRON_SECRET"] = "cron-secret"
	cfg, err = LoadConfig(getenvFrom(env))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if string(cfg.CronSecret) != "cron-secret" {
		t.Errorf("CronSecret = %q", cfg.CronSecret)
	}
}

func TestLoadConfigOpenAIAloneEnablesChatNotLine(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.ChatEnabled() {
		t.Error("ChatEnabled() = true without OPENAI_API_KEY")
	}

	env := validEnv()
	env["OPENAI_API_KEY"] = "openai-key"
	cfg, err = LoadConfig(getenvFrom(env))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if !cfg.ChatEnabled() || cfg.LineEnabled() {
		t.Errorf("ChatEnabled() = %v, LineEnabled() = %v; want true, false", cfg.ChatEnabled(), cfg.LineEnabled())
	}
}

func TestLoadConfigLineWithoutOpenAIFails(t *testing.T) {
	env := validEnv()
	env["LINE_CHANNEL_SECRET"] = "channel-secret"
	env["LINE_CHANNEL_ACCESS_TOKEN"] = "access-token"
	if _, err := LoadConfig(getenvFrom(env)); err == nil {
		t.Fatal("expected error for LINE without OPENAI_API_KEY")
	}
}

func TestLoadConfigLinePartialFails(t *testing.T) {
	env := validEnv()
	env["LINE_CHANNEL_SECRET"] = "channel-secret"
	env["OPENAI_API_KEY"] = "openai-key"
	if _, err := LoadConfig(getenvFrom(env)); err == nil {
		t.Fatal("expected error for LINE without LINE_CHANNEL_ACCESS_TOKEN")
	}
}

func TestLoadConfigChatModelDefaultAndOverride(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.OpenAIChatModel != "gpt-6.1-sol" {
		t.Errorf("default OpenAIChatModel = %q", cfg.OpenAIChatModel)
	}
	env := validEnv()
	env["OPENAI_CHAT_MODEL"] = " gpt-x "
	if cfg, err = LoadConfig(getenvFrom(env)); err != nil || cfg.OpenAIChatModel != "gpt-x" {
		t.Errorf("OpenAIChatModel = %q, err %v", cfg.OpenAIChatModel, err)
	}
}
