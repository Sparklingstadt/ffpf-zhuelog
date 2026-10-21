package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrLoginIDTaken is returned by CreatePasswordAccount when the loginId is
// already used.
var ErrLoginIDTaken = errors.New("store: login id taken")

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

// FindPasswordAccountByID returns the account with the given id, or
// ErrNotFound.
func (s *Store) FindPasswordAccountByID(ctx context.Context, id string) (PasswordAccount, error) {
	var a PasswordAccount
	err := s.pool.QueryRow(ctx,
		`SELECT "id", "loginId", "passwordHash", "sessionVersion" FROM "PasswordAccount" WHERE "id" = $1`,
		id).Scan(&a.ID, &a.LoginID, &a.PasswordHash, &a.SessionVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return PasswordAccount{}, ErrNotFound
	}
	if err != nil {
		return PasswordAccount{}, err
	}
	return a, nil
}

// SetPassword stores a new password hash in one statement, mirroring the web
// app's setPassword: it bumps sessionVersion (revoking every existing API and
// web session) and clears the failure count and the lock. It returns
// ErrNotFound when no account has the id.
func (s *Store) SetPassword(ctx context.Context, id, hash string, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE "PasswordAccount" SET
  "passwordHash" = $2,
  "sessionVersion" = "sessionVersion" + 1,
  "failedAttempts" = 0,
  "lockedUntil" = NULL,
  "updatedAt" = CAST($3 AS TIMESTAMP(3))
WHERE "id" = $1`, id, hash, dbTime(now))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
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

// AccountSummary is what an administrator sees of a member: never the hash or
// the failure counter.
type AccountSummary struct {
	ID          string
	LoginID     string
	DisplayName string
	CreatedAt   time.Time
	Locked      bool
}

// ListPasswordAccounts returns every member account ordered by (createdAt,
// id). Locked is lockedUntil > now.
func (s *Store) ListPasswordAccounts(ctx context.Context, now time.Time) ([]AccountSummary, error) {
	rows, err := s.pool.Query(ctx, `
SELECT "id", "loginId", "displayName", "createdAt", COALESCE("lockedUntil" > CAST($1 AS TIMESTAMP(3)), false)
FROM "PasswordAccount" ORDER BY "createdAt" ASC, "id" ASC`, dbTime(now))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AccountSummary{}
	for rows.Next() {
		var a AccountSummary
		if err := rows.Scan(&a.ID, &a.LoginID, &a.DisplayName, &a.CreatedAt, &a.Locked); err != nil {
			return nil, err
		}
		a.CreatedAt = a.CreatedAt.UTC()
		out = append(out, a)
	}
	return out, rows.Err()
}

// CreatePasswordAccount inserts a member with a new ID and sessionVersion 0.
// It returns ErrLoginIDTaken when the loginId already exists.
func (s *Store) CreatePasswordAccount(ctx context.Context, loginID, displayName, hash string, now time.Time) (AccountSummary, error) {
	a := AccountSummary{ID: newID(), LoginID: loginID, DisplayName: displayName, CreatedAt: dbTime(now)}
	_, err := s.pool.Exec(ctx, `
INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "sessionVersion", "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, 0, CAST($5 AS TIMESTAMP(3)), CAST($5 AS TIMESTAMP(3)))`,
		a.ID, loginID, displayName, hash, a.CreatedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "PasswordAccount_loginId_key" {
		return AccountSummary{}, ErrLoginIDTaken
	}
	if err != nil {
		return AccountSummary{}, err
	}
	return a, nil
}
