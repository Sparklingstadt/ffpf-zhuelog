package main

import (
	"testing"
)

func getenvFrom(env map[string]string) func(string) string {
	return func(key string) string { return env[key] }
}

func TestLoadConfigDefaults(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(map[string]string{"DATABASE_URL": " postgresql://u:p@localhost:5432/db "}))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want 8080", cfg.Port)
	}
	if cfg.DatabaseURL != "postgresql://u:p@localhost:5432/db" {
		t.Errorf("DatabaseURL = %q", cfg.DatabaseURL)
	}

	cfg, err = LoadConfig(getenvFrom(map[string]string{"DATABASE_URL": "postgresql://db", "PORT": "3108"}))
	if err != nil || cfg.Port != "3108" {
		t.Fatalf("PORT=3108: cfg = %+v, err = %v", cfg, err)
	}
}

func TestLoadConfigMissing(t *testing.T) {
	_, err := LoadConfig(getenvFrom(map[string]string{"DATABASE_URL": "  "}))
	if err == nil || err.Error() != "DATABASE_URL is required" {
		t.Fatalf("err = %v, want DATABASE_URL is required", err)
	}
}

// The sign-in variables moved to the web in stage 11; values Go used to refuse
// no longer stop it from starting.
func TestLoadConfigIgnoresRetiredVariables(t *testing.T) {
	cfg, err := LoadConfig(getenvFrom(map[string]string{
		"DATABASE_URL":         "postgresql://db",
		"API_JWT_SECRET":       "short",
		"GITHUB_WEB_CLIENT_ID": "x",
		"FFPF_ID_ISSUER":       "http://evil",
	}))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg != (Config{Port: "8080", DatabaseURL: "postgresql://db"}) {
		t.Errorf("cfg = %+v", cfg)
	}
}
