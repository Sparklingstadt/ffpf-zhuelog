package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// MemberOwnerPrefix starts every member's ownerId: "password:" + account id.
const MemberOwnerPrefix = "password:"

// MemberOwnerID is the ownerId of the member with the given account id.
func MemberOwnerID(accountID string) string { return MemberOwnerPrefix + accountID }

// FfpfOwnerPrefix starts the ownerId of a member who signs in with FFPF ID:
// "ffpf:" + the portal's sub. See ffpf_accounts.go.
const FfpfOwnerPrefix = "ffpf:"

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
