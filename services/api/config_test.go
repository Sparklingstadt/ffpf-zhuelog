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

func TestLoadConfigDemoLoginID(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.DemoLoginID != "" {
		t.Errorf("DemoLoginID = %q, want empty (demo off)", cfg.DemoLoginID)
	}

	env := validEnv()
	env["DEMO_LOGIN_ID"] = " demo "
	if cfg, err = LoadConfig(getenvFrom(env)); err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.DemoLoginID != "demo" {
		t.Errorf("DemoLoginID = %q, want demo", cfg.DemoLoginID)
	}

	for _, bad := range []string{"de", "Demo", "demo user", "デモ"} {
		env["DEMO_LOGIN_ID"] = bad
		if _, err := LoadConfig(getenvFrom(env)); err == nil {
			t.Errorf("DEMO_LOGIN_ID=%q: LoadConfig succeeded, want an error", bad)
		}
	}
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

func ffpfEnv() map[string]string {
	return map[string]string{
		"FFPF_ID_ISSUER":        "https://portal.ffpf.example",
		"FFPF_ID_CLIENT_ID":     "zhuelog",
		"FFPF_ID_CLIENT_SECRET": "ffpf-secret-value",
		"FFPF_ID_REDIRECT_URI":  "https://zhuelog.example/api/auth/callback/ffpf",
	}
}

func TestLoadConfigFFPFAllOrNone(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("none set: %v", err)
	}
	if cfg.FFPFEnabled() || cfg.FFPFIssuer != "" || cfg.FFPFClientID != "" || cfg.FFPFClientSecret != "" || cfg.FFPFRedirectURI != "" {
		t.Errorf("ffpf fields should be empty: %+v", cfg)
	}

	env := validEnv()
	for k, v := range ffpfEnv() {
		env[k] = v
	}
	cfg, err = LoadConfig(getenvFrom(env))
	if err != nil {
		t.Fatalf("all set: %v", err)
	}
	if !cfg.FFPFEnabled() || cfg.FFPFIssuer != "https://portal.ffpf.example" || cfg.FFPFClientID != "zhuelog" ||
		cfg.FFPFClientSecret != "ffpf-secret-value" || cfg.FFPFRedirectURI != "https://zhuelog.example/api/auth/callback/ffpf" {
		t.Errorf("unexpected ffpf config: %+v", cfg)
	}

	for missing := range ffpfEnv() {
		env := validEnv()
		for k, v := range ffpfEnv() {
			if k != missing {
				env[k] = v
			}
		}
		_, err := LoadConfig(getenvFrom(env))
		want := "FFPF_ID_ISSUER, FFPF_ID_CLIENT_ID, FFPF_ID_CLIENT_SECRET and FFPF_ID_REDIRECT_URI must be set together"
		if err == nil || err.Error() != want {
			t.Errorf("missing %s: err = %v, want %q", missing, err, want)
		}
	}
}

func TestLoadConfigFFPFIssuer(t *testing.T) {
	for issuer, ok := range map[string]bool{
		"https://portal.ffpf.example": true,
		"http://localhost:3000":       true,
		"http://127.0.0.1:3000":       true,
		"http://evil":                 false,
		"http://localhost.evil":       false,
		"ftp://portal.ffpf.example":   false,
		"https://":                    false,
		"https://u:p@portal.example":  false,
		"portal.ffpf.example":         false,
		"https://portal.example/?x=1": false,
		"https://portal.example?":     false,
		"https://portal.example/#f":   false,
		"https://portal.example#":     false,
		"https://portal.example/id":   true,
	} {
		t.Run(issuer, func(t *testing.T) {
			env := validEnv()
			for k, v := range ffpfEnv() {
				env[k] = v
			}
			env["FFPF_ID_ISSUER"] = issuer
			_, err := LoadConfig(getenvFrom(env))
			if ok && err != nil {
				t.Fatalf("err = %v, want nil", err)
			}
			if !ok {
				if err == nil || !strings.HasPrefix(err.Error(), "FFPF_ID_ISSUER must be") {
					t.Fatalf("err = %v, want an FFPF_ID_ISSUER error", err)
				}
				if strings.Contains(err.Error(), "ffpf-secret-value") {
					t.Errorf("error contains the secret: %v", err)
				}
			}
		})
	}
}
