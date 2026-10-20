package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	maxFailedAttempts = 5
	lockDuration      = 15 * time.Minute
)

// PasswordAccount is a member account that signs in with loginId and password.
type PasswordAccount struct {
	ID             string
	LoginID        string
	PasswordHash   string
	SessionVersion int
}

// FindPasswordAccountByLoginID returns the account with the given (already
// normalized) loginId, or ErrNotFound.
func (s *Store) FindPasswordAccountByLoginID(ctx context.Context, loginID string) (PasswordAccount, error) {
	var a PasswordAccount
	err := s.pool.QueryRow(ctx,
		`SELECT "id", "loginId", "passwordHash", "sessionVersion" FROM "PasswordAccount" WHERE "loginId" = $1`,
		loginID).Scan(&a.ID, &a.LoginID, &a.PasswordHash, &a.SessionVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return PasswordAccount{}, ErrNotFound
	}
	if err != nil {
		return PasswordAccount{}, err
	}
	return a, nil
}

// SessionVersion returns the account's current session version, or ErrNotFound.
func (s *Store) SessionVersion(ctx context.Context, accountID string) (int, error) {
	var v int
	err := s.pool.QueryRow(ctx,
		`SELECT "sessionVersion" FROM "PasswordAccount" WHERE "id" = $1`, accountID).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return v, nil
}

// ReserveAttempt counts one sign-in attempt before the password is checked. It
// returns false when the account is currently locked (or does not exist). The
// statement mirrors the web app's reserveAttempt so both share one lockout
// state: an expired lock restarts the count at 1, and reaching
// maxFailedAttempts locks the account for lockDuration.
func (s *Store) ReserveAttempt(ctx context.Context, accountID string, now time.Time) (bool, error) {
	now = dbTime(now)
	lockEnd := now.Add(lockDuration)
	tag, err := s.pool.Exec(ctx, `
UPDATE "PasswordAccount" SET
  "failedAttempts" = CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedAttempts" + 1 END,
  "lockedUntil" = CASE WHEN (CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedAttempts" + 1 END) >= $2 THEN CAST($3 AS TIMESTAMP(3)) ELSE NULL END,
  "updatedAt" = CAST($4 AS TIMESTAMP(3))
WHERE "id" = $1 AND ("lockedUntil" IS NULL OR "lockedUntil" <= CAST($4 AS TIMESTAMP(3)))`,
		accountID, maxFailedAttempts, lockEnd, now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// ClearFailures resets the failure counter and lock after a successful sign-in.
func (s *Store) ClearFailures(ctx context.Context, accountID string) error {
	_, err := s.pool.Exec(ctx, `
UPDATE "PasswordAccount" SET "failedAttempts" = 0, "lockedUntil" = NULL, "updatedAt" = CAST($2 AS TIMESTAMP(3))
WHERE "id" = $1`, accountID, dbTime(time.Now()))
	return err
}
