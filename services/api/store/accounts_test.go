package store

import (
	"context"
	"errors"
	"testing"
)

// newAccount inserts a PasswordAccount with a unique loginId and removes it
// when the test ends.
func newAccount(t *testing.T, s *Store) PasswordAccount {
	t.Helper()
	id := newID()
	acc := PasswordAccount{
		ID:             id,
		LoginID:        "user-" + id,
		PasswordHash:   "scrypt:hash-" + id,
		SessionVersion: 7,
	}
	_, err := s.pool.Exec(context.Background(),
		`INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "sessionVersion", "updatedAt")
		 VALUES ($1, $2, $3, $4, $5, now())`,
		acc.ID, acc.LoginID, "Display "+id, acc.PasswordHash, acc.SessionVersion)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "PasswordAccount" WHERE id = $1`, acc.ID)
	})
	return acc
}

func TestFindPasswordAccountAndSessionVersion(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	acc := newAccount(t, s)

	got, err := s.FindPasswordAccountByLoginID(ctx, acc.LoginID)
	if err != nil {
		t.Fatalf("FindPasswordAccountByLoginID: %v", err)
	}
	if got != acc {
		t.Fatalf("got %+v, want %+v", got, acc)
	}
	if _, err := s.FindPasswordAccountByLoginID(ctx, "missing-"+newID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing login: err=%v, want ErrNotFound", err)
	}

	v, err := s.SessionVersion(ctx, acc.ID)
	if err != nil || v != acc.SessionVersion {
		t.Fatalf("SessionVersion = %d, %v; want %d", v, err, acc.SessionVersion)
	}
	if _, err := s.SessionVersion(ctx, "missing-"+newID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing id: err=%v, want ErrNotFound", err)
	}
}
