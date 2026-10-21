// Package store is the PostgreSQL access layer. The schema is owned by Prisma
// migrations; this package never runs DDL.
package store

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	neturl "net/url"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a requested row does not exist.
var ErrNotFound = errors.New("store: not found")

// Store wraps a pgx connection pool.
type Store struct {
	pool *pgxpool.Pool
}

// openTimeout bounds Open's initial connect and ping; a var so tests can
// shorten it.
var openTimeout = 15 * time.Second

// Open connects to the database at url and verifies the connection, giving up
// after 15 seconds (or when ctx is done).
func Open(ctx context.Context, url string) (*Store, error) {
	cfg, err := parseConfig(url)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, openTimeout)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

// errInvalidURL deliberately carries no detail: parse errors can echo the
// connection string, password included.
var errInvalidURL = errors.New("store: invalid database url")

// parseConfig builds the pool config from a URL rewritten by secureURL.
func parseConfig(rawURL string) (*pgxpool.Config, error) {
	rawURL, schema, err := secureURL(rawURL)
	if err != nil {
		return nil, err
	}
	cfg, err := pgxpool.ParseConfig(rawURL)
	if err != nil {
		return nil, errInvalidURL
	}
	if schema != "" {
		cfg.ConnConfig.RuntimeParams["search_path"] = schema
	}
	// Vercel scales instances out on its own, so keep each one's share of
	// Neon's pooled connections small.
	cfg.MaxConns = 3
	return cfg, nil
}

// secureURL mirrors the web's securePostgresConnectionString
// (src/infrastructure/config/postgres-connection.ts): for a host other than
// localhost, 127.0.0.1 or ::1, or when sslmode is prefer, require or
// verify-ca, it forces sslmode=verify-full and drops the libpq-compat "ssl"
// and "uselibpqcompat" params.
//
// It also removes Prisma's "schema" param, which PostgreSQL rejects as a
// runtime setting, and returns it so a non-public schema can become
// search_path. "public" (the default) is dropped silently: poolers may reject
// a search_path startup parameter.
func secureURL(rawURL string) (string, string, error) {
	u, err := neturl.Parse(rawURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return "", "", errInvalidURL
	}
	q := u.Query()

	schema := q.Get("schema")
	q.Del("schema")
	if schema == "public" {
		schema = ""
	}

	upgrade := true
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		upgrade = false
	}
	switch q.Get("sslmode") {
	case "prefer", "require", "verify-ca":
		upgrade = true
	}
	if upgrade {
		q.Set("sslmode", "verify-full")
		q.Del("uselibpqcompat")
		q.Del("ssl")
	}

	u.RawQuery = q.Encode()
	return u.String(), schema, nil
}

// Ping checks that the database is reachable.
func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// Close releases the connection pool.
func (s *Store) Close() {
	s.pool.Close()
}

const idAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// newID returns an ID shaped like a Prisma cuid: "c" followed by 24 random
// lowercase alphanumeric characters.
func newID() string {
	const n = 24
	max := big.NewInt(int64(len(idAlphabet)))
	b := make([]byte, 0, n+1)
	b = append(b, 'c')
	for i := 0; i < n; i++ {
		v, err := rand.Int(rand.Reader, max) // uniform, no modulo bias
		if err != nil {
			panic(fmt.Sprintf("store: crypto/rand failed: %v", err))
		}
		b = append(b, idAlphabet[v.Int64()])
	}
	return string(b)
}
