package main

import (
	"fmt"
	"strings"
)

// Config holds the API server settings read from the environment. Since stage
// 11 of the Go retirement the server serves only its health routes, so it
// reads nothing else; the sign-in variables it used to read are ignored.
type Config struct {
	Port        string
	DatabaseURL string
}

// LoadConfig reads and validates the configuration. Secret values are never
// included in error messages.
func LoadConfig(getenv func(string) string) (Config, error) {
	get := func(name string) string { return strings.TrimSpace(getenv(name)) }

	cfg := Config{Port: get("PORT"), DatabaseURL: get("DATABASE_URL")}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("%s is required", "DATABASE_URL")
	}
	return cfg, nil
}
