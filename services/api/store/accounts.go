package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrLoginIDTaken is returned by CreatePasswordAccount when the loginId is
// already used.
var ErrLoginIDTaken = errors.New("store: login id taken")

// MemberOwnerPrefix starts every member's ownerId: "password:" + account id.
const MemberOwnerPrefix = "password:"

// MemberOwnerID is the ownerId of the member with the given account id.
func MemberOwnerID(accountID string) string { return MemberOwnerPrefix + accountID }

// PasswordAccount is a member account that signs in with loginId and password.
type PasswordAccount struct {
	ID             string
	LoginID        string
	DisplayName    string
	PasswordHash   string
	SessionVersion int
}

// accountKey is the column an account is looked up by. Only the constants
// below exist, so the column name spliced into the query never comes from
// input.
type accountKey string

const (
	accountByLoginID accountKey = "loginId"
	accountByID      accountKey = "id"
)

func (s *Store) findPasswordAccount(ctx context.Context, key accountKey, value string) (PasswordAccount, error) {
	var a PasswordAccount
	err := s.pool.QueryRow(ctx,
		`SELECT "id", "loginId", "displayName", "passwordHash", "sessionVersion" FROM "PasswordAccount" WHERE "`+string(key)+`" = $1`,
		value).Scan(&a.ID, &a.LoginID, &a.DisplayName, &a.PasswordHash, &a.SessionVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return PasswordAccount{}, ErrNotFound
	}
	if err != nil {
		return PasswordAccount{}, fmt.Errorf("store: find password account: %w", err)
	}
	return a, nil
}

// FindPasswordAccountByLoginID returns the account with the given (already
// normalized) loginId, or ErrNotFound.
func (s *Store) FindPasswordAccountByLoginID(ctx context.Context, loginID string) (PasswordAccount, error) {
	return s.findPasswordAccount(ctx, accountByLoginID, loginID)
}

// FindPasswordAccountByID returns the account with the given id, or
// ErrNotFound.
func (s *Store) FindPasswordAccountByID(ctx context.Context, id string) (PasswordAccount, error) {
	return s.findPasswordAccount(ctx, accountByID, id)
}

// SetPassword stores a new password hash in one statement, mirroring the web
// app's setPassword: it bumps sessionVersion (revoking every existing API and
// web session). It returns ErrNotFound when no account has the id.
func (s *Store) SetPassword(ctx context.Context, id, hash string, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE "PasswordAccount" SET
  "passwordHash" = $2,
  "sessionVersion" = "sessionVersion" + 1,
  "updatedAt" = CAST($3 AS TIMESTAMP(3))
WHERE "id" = $1`, id, hash, dbTime(now))
	if err != nil {
		return fmt.Errorf("store: set password: %w", err)
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
		return 0, fmt.Errorf("store: session version: %w", err)
	}
	return v, nil
}

// AccountSummary is what an administrator sees of a member: never the hash.
type AccountSummary struct {
	ID          string
	LoginID     string
	DisplayName string
	CreatedAt   time.Time
}

// ListPasswordAccounts returns every member account ordered by (createdAt,
// id).
func (s *Store) ListPasswordAccounts(ctx context.Context) ([]AccountSummary, error) {
	rows, err := s.pool.Query(ctx, `
SELECT "id", "loginId", "displayName", "createdAt"
FROM "PasswordAccount" ORDER BY "createdAt" ASC, "id" ASC`)
	if err != nil {
		return nil, fmt.Errorf("store: list password accounts: %w", err)
	}
	defer rows.Close()
	out := []AccountSummary{}
	for rows.Next() {
		var a AccountSummary
		if err := rows.Scan(&a.ID, &a.LoginID, &a.DisplayName, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("store: list password accounts: %w", err)
		}
		a.CreatedAt = a.CreatedAt.UTC()
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list password accounts: %w", err)
	}
	return out, nil
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
		return AccountSummary{}, fmt.Errorf("store: create password account: %w", err)
	}
	return a, nil
}
