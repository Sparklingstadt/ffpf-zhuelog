package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// RefreshToken is the stored metadata of a refresh token. The token itself is
// never stored, only its hash. SessionVersion is nil for admin tokens; Login is
// the admin's GitHub login (informational only, never used for authorization)
// and empty (NULL) for member tokens.
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
	if err := insertRefreshToken(ctx, s.pool, t, tokenHash); err != nil {
		return fmt.Errorf("store: insert refresh token: %w", err)
	}
	return nil
}

// insertRefreshToken returns an unwrapped database error.
func insertRefreshToken(ctx context.Context, e dbtx, t RefreshToken, tokenHash string) error {
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
		return RefreshToken{}, fmt.Errorf("store: find refresh token: %w", err)
	}
	if login != nil {
		t.Login = *login
	}
	return t, nil
}

// lockFamily takes a transaction-scoped advisory lock on familyID. Every
// family-level write (rotation, sibling insert, family revocation) takes it,
// so a revocation cannot interleave with an insert into the same family and
// be undone by it.
//
// The checks that run after the lock (the conditional UPDATE, the EXISTS in
// InsertSiblingIfFamilyActive) rely on READ COMMITTED, the pgx/Postgres
// default: each statement takes a fresh snapshot, so it sees what the
// previous lock holder committed. Under REPEATABLE READ or SERIALIZABLE the
// snapshot is taken at the first statement (this lock), so a waiter would
// check stale data and the guarantees above would break.
func lockFamily(ctx context.Context, tx pgx.Tx, familyID string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, familyID)
	return err
}

// RotateRefreshToken revokes the token oldID and stores next (of the same
// family) in one transaction under the family lock. It returns false,
// changing nothing, when oldID is already revoked (or missing). The
// conditional UPDATE locks the row, so of several concurrent callers exactly
// one wins.
func (s *Store) RotateRefreshToken(ctx context.Context, oldID string, next RefreshToken, nextHash string, now time.Time) (bool, error) {
	rotated := false
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockFamily(ctx, tx, next.FamilyID); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx,
			`UPDATE "ApiRefreshToken" SET "revokedAt" = $2 WHERE "id" = $1 AND "revokedAt" IS NULL`,
			oldID, dbTime(now))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		if err := insertRefreshToken(ctx, tx, next, nextHash); err != nil {
			return err
		}
		rotated = true
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("store: rotate refresh token: %w", err)
	}
	return rotated, nil
}

// InsertSiblingIfFamilyActive stores next under nextHash if its family still
// has an unrevoked, unexpired token, checking and inserting in one
// transaction under the family lock. It returns false, inserting nothing,
// when the family is not active.
func (s *Store) InsertSiblingIfFamilyActive(ctx context.Context, next RefreshToken, nextHash string, now time.Time) (bool, error) {
	inserted := false
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockFamily(ctx, tx, next.FamilyID); err != nil {
			return err
		}
		var active bool
		if err := tx.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM "ApiRefreshToken"
  WHERE "familyId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > $2)`,
			next.FamilyID, dbTime(now)).Scan(&active); err != nil {
			return err
		}
		if !active {
			return nil
		}
		if err := insertRefreshToken(ctx, tx, next, nextHash); err != nil {
			return err
		}
		inserted = true
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("store: insert sibling refresh token: %w", err)
	}
	return inserted, nil
}

// RevokeFamily revokes every still-active token of the family, under the
// family lock.
func (s *Store) RevokeFamily(ctx context.Context, familyID string, now time.Time) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockFamily(ctx, tx, familyID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`UPDATE "ApiRefreshToken" SET "revokedAt" = $2 WHERE "familyId" = $1 AND "revokedAt" IS NULL`,
			familyID, dbTime(now))
		return err
	})
	if err != nil {
		return fmt.Errorf("store: revoke family: %w", err)
	}
	return nil
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
	if err != nil {
		return fmt.Errorf("store: prune refresh tokens: %w", err)
	}
	return nil
}

// DeleteExpiredRefreshTokens deletes only ownerID's expired tokens. Guest
// sessions use it instead of PruneRefreshTokens, whose revoked-family subquery
// grows with the number of live rows.
func (s *Store) DeleteExpiredRefreshTokens(ctx context.Context, ownerID string, now time.Time) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM "ApiRefreshToken" WHERE "ownerId" = $1 AND "expiresAt" <= $2`,
		ownerID, dbTime(now))
	if err != nil {
		return fmt.Errorf("store: delete expired refresh tokens: %w", err)
	}
	return nil
}
