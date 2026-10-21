package store

import (
	"context"
	"net"
	neturl "net/url"
	"regexp"
	"strings"
	"sync"
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
	cfg, err := parseConfig("postgresql://u:p@localhost:5432/db?schema=app&sslmode=disable")
	if err != nil {
		t.Fatalf("parseConfig: %v", err)
	}
	if got := cfg.ConnConfig.RuntimeParams["search_path"]; got != "app" {
		t.Errorf("search_path = %q, want app", got)
	}
	if _, ok := cfg.ConnConfig.RuntimeParams["schema"]; ok {
		t.Error("schema must not be sent to the server")
	}
	if cfg.MaxConns != 3 {
		t.Errorf("MaxConns = %d, want 3", cfg.MaxConns)
	}

	for _, raw := range []string{
		"postgresql://u:p@localhost:5432/db",
		"postgresql://u:p@localhost:5432/db?schema=public&sslmode=disable",
		"postgresql://u:p@localhost:5432/db?schema=",
	} {
		cfg, err = parseConfig(raw)
		if err != nil {
			t.Fatalf("parseConfig(%q): %v", raw, err)
		}
		for _, k := range []string{"search_path", "schema"} {
			if _, ok := cfg.ConnConfig.RuntimeParams[k]; ok {
				t.Errorf("%q: %s must not be set", raw, k)
			}
		}
	}
}

func TestSecureURL(t *testing.T) {
	cases := []struct {
		name, in   string
		wantSSL    string // "" means the sslmode param is absent
		wantSchema string
	}{
		{"remote without sslmode", "postgresql://u:p@ep-x-pooler.neon.tech/db", "verify-full", ""},
		{"remote require", "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require", "verify-full", ""},
		{"remote disable", "postgres://u:p@db.example.com/db?sslmode=disable", "verify-full", ""},
		{"remote verify-full", "postgresql://u:p@db.example.com/db?sslmode=verify-full", "verify-full", ""},
		{"remote public schema", "postgresql://u:p@db.example.com/db?schema=public&sslmode=require", "verify-full", ""},
		{"remote other schema", "postgresql://u:p@db.example.com/db?schema=app", "verify-full", "app"},
		{"localhost default", "postgresql://u:p@localhost:5439/db", "", ""},
		{"localhost disable", "postgresql://u:p@localhost:5439/db?sslmode=disable", "disable", ""},
		{"127.0.0.1 disable", "postgresql://u:p@127.0.0.1/db?sslmode=disable", "disable", ""},
		{"::1 disable", "postgresql://u:p@[::1]:5432/db?sslmode=disable", "disable", ""},
		{"localhost prefer", "postgresql://u:p@localhost/db?sslmode=prefer", "verify-full", ""},
		{"localhost require", "postgresql://u:p@localhost/db?sslmode=require", "verify-full", ""},
		{"localhost verify-ca", "postgresql://u:p@localhost/db?sslmode=verify-ca", "verify-full", ""},
		{"localhost allow", "postgresql://u:p@localhost/db?sslmode=allow", "allow", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, schema, err := secureURL(tc.in)
			if err != nil {
				t.Fatalf("secureURL: %v", err)
			}
			u, err := neturl.Parse(out)
			if err != nil {
				t.Fatalf("parse %q: %v", out, err)
			}
			q := u.Query()
			if got := q.Get("sslmode"); got != tc.wantSSL {
				t.Errorf("sslmode = %q, want %q (url %q)", got, tc.wantSSL, out)
			}
			if q.Has("schema") {
				t.Errorf("schema param kept: %q", out)
			}
			if schema != tc.wantSchema {
				t.Errorf("schema = %q, want %q", schema, tc.wantSchema)
			}
		})
	}
}

func TestSecureURLDropsLibpqCompatParams(t *testing.T) {
	out, _, err := secureURL("postgresql://u:p@db.example.com/db?sslmode=require&uselibpqcompat=true&ssl=true&application_name=api")
	if err != nil {
		t.Fatalf("secureURL: %v", err)
	}
	u, _ := neturl.Parse(out)
	q := u.Query()
	for _, k := range []string{"uselibpqcompat", "ssl"} {
		if q.Has(k) {
			t.Errorf("%s kept: %q", k, out)
		}
	}
	if q.Get("application_name") != "api" {
		t.Errorf("unrelated params must be kept: %q", out)
	}

	// On a local host without a TLS upgrade they are left alone, like the web.
	out, _, _ = secureURL("postgresql://u:p@localhost/db?sslmode=disable&ssl=false")
	if u, _ := neturl.Parse(out); !u.Query().Has("ssl") {
		t.Errorf("local url without upgrade changed: %q", out)
	}
}

func TestSecureURLRejectsNonPostgresURLs(t *testing.T) {
	for _, raw := range []string{"mysql://u:p@db.example.com/db", "host=db.example.com dbname=db", "://bad"} {
		if _, _, err := secureURL(raw); err == nil {
			t.Errorf("secureURL(%q) succeeded, want an error", raw)
		}
		if _, err := parseConfig(raw); err == nil {
			t.Errorf("parseConfig(%q) succeeded, want an error", raw)
		}
	}
}

func TestParseConfigRemoteUsesVerifiedTLS(t *testing.T) {
	cfg, err := parseConfig("postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require")
	if err != nil {
		t.Fatalf("parseConfig: %v", err)
	}
	tlsCfg := cfg.ConnConfig.TLSConfig
	if tlsCfg == nil || tlsCfg.InsecureSkipVerify || tlsCfg.ServerName != "ep-x-pooler.neon.tech" {
		t.Fatalf("TLSConfig = %+v, want certificate and host verification", tlsCfg)
	}
	for _, fb := range cfg.ConnConfig.Fallbacks {
		if fb.TLSConfig == nil {
			t.Fatal("plaintext fallback configured for a remote host")
		}
	}
}

func TestOpenBoundsInitialConnect(t *testing.T) {
	// A server that accepts connections and never answers.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	var (
		mu   sync.Mutex
		held []net.Conn
	)
	t.Cleanup(func() {
		mu.Lock()
		defer mu.Unlock()
		for _, c := range held {
			_ = c.Close()
		}
	})
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			held = append(held, c)
			mu.Unlock()
		}
	}()

	old := openTimeout
	openTimeout = 200 * time.Millisecond
	t.Cleanup(func() { openTimeout = old })

	done := make(chan error, 1)
	go func() {
		s, err := Open(context.Background(), "postgresql://u:hunter2@"+ln.Addr().String()+"/db?sslmode=disable")
		if s != nil {
			s.Close()
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Open succeeded against a silent server")
		}
		if strings.Contains(err.Error(), "hunter2") {
			t.Fatalf("error leaks the password: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Open did not give up on a silent server")
	}
}
