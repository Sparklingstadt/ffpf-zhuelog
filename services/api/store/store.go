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

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a requested row does not exist.
var ErrNotFound = errors.New("store: not found")

// Store wraps a pgx connection pool.
type Store struct {
	pool *pgxpool.Pool
}

// Open connects to the database at url and verifies the connection.
func Open(ctx context.Context, url string) (*Store, error) {
	cfg, err := parseConfig(url)
	if err != nil {
		return nil, err
	}
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

// parseConfig builds the pool config. Prisma-style URLs may carry a
// "?schema=public" parameter that PostgreSQL rejects as a runtime setting, so it
// is removed and applied as search_path instead.
func parseConfig(rawURL string) (*pgxpool.Config, error) {
	schema := ""
	if u, err := neturl.Parse(rawURL); err == nil && u.Query().Has("schema") {
		q := u.Query()
		schema = q.Get("schema")
		q.Del("schema")
		u.RawQuery = q.Encode()
		rawURL = u.String()
	}
	cfg, err := pgxpool.ParseConfig(rawURL)
	if err != nil {
		// Do not wrap the pgx error text: it can echo the connection string.
		return nil, errors.New("store: invalid database url")
	}
	if schema != "" {
		cfg.ConnConfig.RuntimeParams["search_path"] = schema
	}
	cfg.MaxConns = 5
	return cfg, nil
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
