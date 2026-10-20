package store

import (
	"context"
	"regexp"
	"testing"
	"time"
)

func TestNewIDFormat(t *testing.T) {
	re := regexp.MustCompile(`^c[a-z0-9]{24}$`)
	seen := make(map[string]struct{}, 1000)
	for i := 0; i < 1000; i++ {
		id := newID()
		if !re.MatchString(id) {
			t.Fatalf("newID() = %q, want match %s", id, re)
		}
		if _, dup := seen[id]; dup {
			t.Fatalf("newID() returned duplicate %q", id)
		}
		seen[id] = struct{}{}
	}
}

func TestOpenAndPing(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

func TestParseConfigPrismaSchemaParam(t *testing.T) {
	cfg, err := parseConfig("postgresql://u:p@localhost:5432/db?schema=public&sslmode=disable")
	if err != nil {
		t.Fatalf("parseConfig: %v", err)
	}
	if got := cfg.ConnConfig.RuntimeParams["search_path"]; got != "public" {
		t.Errorf("search_path = %q, want public", got)
	}
	if _, ok := cfg.ConnConfig.RuntimeParams["schema"]; ok {
		t.Error("schema must not be sent to the server")
	}
	if cfg.MaxConns != 5 {
		t.Errorf("MaxConns = %d, want 5", cfg.MaxConns)
	}

	cfg, err = parseConfig("postgresql://u:p@localhost:5432/db")
	if err != nil {
		t.Fatalf("parseConfig without schema: %v", err)
	}
	if _, ok := cfg.ConnConfig.RuntimeParams["search_path"]; ok {
		t.Error("search_path must not be set when schema is absent")
	}
}
