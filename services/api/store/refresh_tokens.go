package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// RefreshToken is the stored metadata of a refresh token. The token itself is
// never stored, only its hash. SessionVersion is nil for admin tokens; Login is
// the admin's GitHub login and empty (NULL) for member tokens.
type RefreshToken struct {
	ID, OwnerID, Role string
	Login             string
	SessionVersion    *int
	FamilyID          string
	ExpiresAt         time.Time
	RevokedAt         *time.Time
}

// InsertRefreshToken stores t under tokenHash. An empty t.ID gets a new ID.
func (s *Store) InsertRefreshToken(ctx context.Context, t RefreshToken, tokenHash string) error {
	return insertRefreshToken(ctx, s.pool, t, tokenHash)
}

type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func insertRefreshToken(ctx context.Context, e execer, t RefreshToken, tokenHash string) error {
	if t.ID == "" {
		t.ID = newID()
	}
	var revoked *time.Time
	if t.RevokedAt != nil {
		v := dbTime(*t.RevokedAt)
		revoked = &v
	}
	var login *string
	if t.Login != "" {
		login = &t.Login
	}
	_, err := e.Exec(ctx, `
INSERT INTO "ApiRefreshToken" ("id", "ownerId", "role", "login", "sessionVersion", "tokenHash", "familyId", "expiresAt", "revokedAt")
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		t.ID, t.OwnerID, t.Role, login, t.SessionVersion, tokenHash, t.FamilyID, dbTime(t.ExpiresAt), revoked)
	return err
}

// FindRefreshToken returns the token stored under tokenHash, or ErrNotFound.
func (s *Store) FindRefreshToken(ctx context.Context, tokenHash string) (RefreshToken, error) {
	var t RefreshToken
	var login *string
	err := s.pool.QueryRow(ctx, `
SELECT "id", "ownerId", "role", "login", "sessionVersion", "familyId", "expiresAt", "revokedAt"
FROM "ApiRefreshToken" WHERE "tokenHash" = $1`, tokenHash).
		Scan(&t.ID, &t.OwnerID, &t.Role, &login, &t.SessionVersion, &t.FamilyID, &t.ExpiresAt, &t.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return RefreshToken{}, ErrNotFound
	}
	if err != nil {
		return RefreshToken{}, err
	}
	if login != nil {
		t.Login = *login
	}
	return t, nil
}

// RotateRefreshToken revokes the token oldID and stores next in one
// transaction. It returns false, changing nothing, when oldID is already
// revoked (or missing). The conditional UPDATE locks the row, so of several
// concurrent callers exactly one wins.
func (s *Store) RotateRefreshToken(ctx context.Context, oldID string, next RefreshToken, nextHash string, now time.Time) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx,
		`UPDATE "ApiRefreshToken" SET "revokedAt" = $2 WHERE "id" = $1 AND "revokedAt" IS NULL`,
		oldID, dbTime(now))
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, tx.Commit(ctx)
	}
	if err := insertRefreshToken(ctx, tx, next, nextHash); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

// RevokeFamily revokes every still-active token of the family.
func (s *Store) RevokeFamily(ctx context.Context, familyID string, now time.Time) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE "ApiRefreshToken" SET "revokedAt" = $2 WHERE "familyId" = $1 AND "revokedAt" IS NULL`,
		familyID, dbTime(now))
	return err
}

// PruneRefreshTokens deletes ownerID's expired tokens, and its revoked tokens
// whose family has no unrevoked, unexpired token left. Rotated tokens of a
// still-live family are kept, so replaying one is still detected as reuse and
// revokes the family.
func (s *Store) PruneRefreshTokens(ctx context.Context, ownerID string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
DELETE FROM "ApiRefreshToken" WHERE "ownerId" = $1 AND (
  "expiresAt" <= $2 OR (
    "revokedAt" IS NOT NULL AND "familyId" NOT IN (
      SELECT "familyId" FROM "ApiRefreshToken"
      WHERE "ownerId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > $2)))`,
		ownerID, dbTime(now))
	return err
}
