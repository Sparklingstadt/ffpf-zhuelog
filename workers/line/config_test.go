package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func configEnv(t *testing.T) {
	t.Helper()
	for k := range configKeys {
		old, exists := os.LookupEnv(k)
		os.Unsetenv(k)
		t.Cleanup(func() {
			if exists {
				os.Setenv(k, old)
			} else {
				os.Unsetenv(k)
			}
		})
	}
	t.Setenv("NODE_ENV", "development")
	t.Setenv("CHAT_PROVIDER", "codex-local")
	t.Setenv("LINE_WORKER_TOKEN", strings.Repeat("a", 64))
}
func TestConfigOrigins(t *testing.T) {
	configEnv(t)
	for _, origin := range []string{"https://example.com", "http://127.0.0.1:1234", "http://[::1]:3000/", "http://localhost:3000"} {
		t.Setenv("LINE_WORKER_URL", origin)
		if _, err := loadConfig(t.TempDir()); err != nil {
			t.Errorf("valid origin %s: %v", origin, err)
		}
	}
	for _, origin := range []string{"http://example.com", "https://u:p@example.com", "https://example.com/path", "https://example.com?x=1", "https://example.com?", "https://example.com#x", "file:///tmp/a", "https:///", "http://127.0.0.2"} {
		t.Setenv("LINE_WORKER_URL", origin)
		if _, err := loadConfig(t.TempDir()); err == nil {
			t.Errorf("accepted %s", origin)
		}
	}
}
func TestConfigPrecedenceAndIsolation(t *testing.T) {
	configEnv(t)
	dir := t.TempDir()
	for name, data := range map[string]string{
		".env":                   "LINE_WORKER_URL=https://base.example\nDATABASE_URL=secret\n",
		".env.local":             "LINE_WORKER_URL='https://local.example' # comment\n",
		".env.development.local": "export LINE_WORKER_URL=\"https://dev.example\"\nLINE_DEV_ISSUES_ENABLED=true\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	c, err := loadConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	if c.endpoint != "https://dev.example/api/line/worker" || !c.development {
		t.Fatal("incorrect dotenv precedence")
	}
	t.Setenv("LINE_WORKER_URL", "http://localhost:1234")
	t.Setenv("LINE_DEV_ISSUES_ENABLED", "false")
	c, err = loadConfig(dir)
	if err != nil || c.development || c.endpoint != "http://localhost:1234/api/line/worker" {
		t.Fatal("environment did not win")
	}
}
func TestConfigLocalOnly(t *testing.T) {
	for key, value := range map[string]string{"VERCEL": "1", "NODE_ENV": "production", "CHAT_PROVIDER": "openai", "LINE_WORKER_TOKEN": "short"} {
		t.Run(key, func(t *testing.T) {
			configEnv(t)
			t.Setenv(key, value)
			if _, err := loadConfig(t.TempDir()); err == nil {
				t.Fatal("must fail closed")
			}
		})
	}
}
func TestEnvRejectsExpansion(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{"$TOKEN", "'unterminated", "$(echo secret)", "`echo secret`", `"foo" junk`} {
		if _, err := literalEnv(raw); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
}
