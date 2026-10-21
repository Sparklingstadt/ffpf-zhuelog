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
