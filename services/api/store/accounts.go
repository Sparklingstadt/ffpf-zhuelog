package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
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
