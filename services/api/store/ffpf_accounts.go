package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// FfpfOwnerID is the ownerId of the member with the given FFPF ID sub.
func FfpfOwnerID(sub string) string { return FfpfOwnerPrefix + sub }

// FfpfAccount is a member who signs in with FFPF ID. ID is the portal's sub;
// Email is for display only and never used for authorization.
type FfpfAccount struct {
	ID, Email, DisplayName string
	SessionVersion         int
}

// UpsertFfpfAccount records a sign-in: it creates the account with
// sessionVersion 0, or, when it exists, updates email, displayName,
// lastLoginAt and updatedAt while keeping sessionVersion and createdAt.
func (s *Store) UpsertFfpfAccount(ctx context.Context, a FfpfAccount, now time.Time) (FfpfAccount, error) {
	var out FfpfAccount
	err := s.pool.QueryRow(ctx, `
INSERT INTO "FfpfAccount" ("id", "email", "displayName", "sessionVersion", "createdAt", "updatedAt", "lastLoginAt")
VALUES ($1, $2, $3, 0, CAST($4 AS TIMESTAMP(3)), CAST($4 AS TIMESTAMP(3)), CAST($4 AS TIMESTAMP(3)))
ON CONFLICT ("id") DO UPDATE SET
  "email" = EXCLUDED."email",
  "displayName" = EXCLUDED."displayName",
  "lastLoginAt" = EXCLUDED."lastLoginAt",
  "updatedAt" = EXCLUDED."updatedAt"
RETURNING "id", "email", "displayName", "sessionVersion"`,
		a.ID, a.Email, a.DisplayName, dbTime(now)).Scan(&out.ID, &out.Email, &out.DisplayName, &out.SessionVersion)
	if err != nil {
		return FfpfAccount{}, fmt.Errorf("store: upsert ffpf account: %w", err)
	}
	return out, nil
}

// FindFfpfAccount returns the account with the given id, or ErrNotFound.
func (s *Store) FindFfpfAccount(ctx context.Context, id string) (FfpfAccount, error) {
	var a FfpfAccount
	err := s.pool.QueryRow(ctx,
		`SELECT "id", "email", "displayName", "sessionVersion" FROM "FfpfAccount" WHERE "id" = $1`,
		id).Scan(&a.ID, &a.Email, &a.DisplayName, &a.SessionVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return FfpfAccount{}, ErrNotFound
	}
	if err != nil {
		return FfpfAccount{}, fmt.Errorf("store: find ffpf account: %w", err)
	}
	return a, nil
}

// FfpfSessionVersion returns the account's current session version, or
// ErrNotFound.
func (s *Store) FfpfSessionVersion(ctx context.Context, id string) (int, error) {
	var v int
	err := s.pool.QueryRow(ctx,
		`SELECT "sessionVersion" FROM "FfpfAccount" WHERE "id" = $1`, id).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("store: ffpf session version: %w", err)
	}
	return v, nil
}
