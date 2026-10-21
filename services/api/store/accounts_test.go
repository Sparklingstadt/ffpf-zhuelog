package store

import (
	"context"
	"errors"
	"testing"
	"time"
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

func attemptState(t *testing.T, s *Store, id string) (int, *time.Time) {
	t.Helper()
	var failed int
	var locked *time.Time
	err := s.pool.QueryRow(context.Background(),
		`SELECT "failedAttempts", "lockedUntil" FROM "PasswordAccount" WHERE id = $1`, id).Scan(&failed, &locked)
	if err != nil {
		t.Fatalf("read attempt state: %v", err)
	}
	return failed, locked
}

func TestReserveAttemptLocksOnFifth(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	acc := newAccount(t, s)
	now := fixedNow()

	for i := 1; i <= 4; i++ {
		ok, err := s.ReserveAttempt(ctx, acc.ID, now)
		if err != nil || !ok {
			t.Fatalf("attempt %d: ok=%v err=%v, want true", i, ok, err)
		}
		failed, locked := attemptState(t, s, acc.ID)
		if failed != i || locked != nil {
			t.Fatalf("attempt %d: failed=%d locked=%v, want %d and no lock", i, failed, locked, i)
		}
	}

	ok, err := s.ReserveAttempt(ctx, acc.ID, now)
	if err != nil || !ok {
		t.Fatalf("attempt 5: ok=%v err=%v, want true", ok, err)
	}
	failed, locked := attemptState(t, s, acc.ID)
	if failed != 5 || locked == nil || !locked.Equal(now.Add(15*time.Minute)) {
		t.Fatalf("attempt 5: failed=%d locked=%v, want 5 and %v", failed, locked, now.Add(15*time.Minute))
	}

	ok, err = s.ReserveAttempt(ctx, acc.ID, now)
	if err != nil || ok {
		t.Fatalf("attempt 6: ok=%v err=%v, want false", ok, err)
	}
	failed, _ = attemptState(t, s, acc.ID)
	if failed != 5 {
		t.Fatalf("failedAttempts after locked attempt = %d, want 5", failed)
	}
}

func TestReserveAttemptAfterExpiredLock(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	acc := newAccount(t, s)
	now := fixedNow()

	_, err := s.pool.Exec(ctx,
		`UPDATE "PasswordAccount" SET "failedAttempts" = 5, "lockedUntil" = $2 WHERE id = $1`,
		acc.ID, now.Add(-time.Minute))
	if err != nil {
		t.Fatalf("seed lock: %v", err)
	}

	ok, err := s.ReserveAttempt(ctx, acc.ID, now)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v, want true", ok, err)
	}
	failed, locked := attemptState(t, s, acc.ID)
	if failed != 1 || locked != nil {
		t.Fatalf("failed=%d locked=%v, want 1 and no lock", failed, locked)
	}
}

func TestClearFailures(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	acc := newAccount(t, s)
	now := fixedNow()

	for i := 0; i < 3; i++ {
		if ok, err := s.ReserveAttempt(ctx, acc.ID, now); err != nil || !ok {
			t.Fatalf("reserve %d: ok=%v err=%v", i, ok, err)
		}
	}
	if err := s.ClearFailures(ctx, acc.ID); err != nil {
		t.Fatalf("ClearFailures: %v", err)
	}
	failed, locked := attemptState(t, s, acc.ID)
	if failed != 0 || locked != nil {
		t.Fatalf("failed=%d locked=%v, want 0 and no lock", failed, locked)
	}
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

func TestFindPasswordAccountByID(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	acc := newAccount(t, s)

	got, err := s.FindPasswordAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatalf("FindPasswordAccountByID: %v", err)
	}
	if got != acc {
		t.Fatalf("got %+v, want %+v", got, acc)
	}
	if _, err := s.FindPasswordAccountByID(ctx, "missing-"+newID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing id: err=%v, want ErrNotFound", err)
	}
}

func TestSetPassword(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	acc := newAccount(t, s)
	other := newAccount(t, s)
	now := fixedNow()

	// Leave the account locked with failures counted.
	for i := 0; i < 5; i++ {
		if ok, err := s.ReserveAttempt(ctx, acc.ID, now); err != nil || !ok {
			t.Fatalf("reserve %d: ok=%v err=%v", i, ok, err)
		}
	}
	if _, locked := attemptState(t, s, acc.ID); locked == nil {
		t.Fatal("seed: account is not locked")
	}

	later := now.Add(time.Hour)
	if err := s.SetPassword(ctx, acc.ID, "scrypt:new-hash", later); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	got, err := s.FindPasswordAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatalf("FindPasswordAccountByID: %v", err)
	}
	if got.PasswordHash != "scrypt:new-hash" {
		t.Fatalf("PasswordHash = %q, want the new hash", got.PasswordHash)
	}
	if got.SessionVersion != acc.SessionVersion+1 {
		t.Fatalf("SessionVersion = %d, want %d", got.SessionVersion, acc.SessionVersion+1)
	}
	failed, locked := attemptState(t, s, acc.ID)
	if failed != 0 || locked != nil {
		t.Fatalf("failed=%d locked=%v, want 0 and no lock", failed, locked)
	}
	var updatedAt time.Time
	if err := s.pool.QueryRow(ctx, `SELECT "updatedAt" FROM "PasswordAccount" WHERE id = $1`, acc.ID).Scan(&updatedAt); err != nil {
		t.Fatalf("read updatedAt: %v", err)
	}
	if !updatedAt.Equal(later) {
		t.Fatalf("updatedAt = %v, want %v", updatedAt, later)
	}

	// Other accounts are untouched.
	if o, err := s.FindPasswordAccountByID(ctx, other.ID); err != nil || o != other {
		t.Fatalf("other account = %+v, %v; want %+v", o, err, other)
	}

	if err := s.SetPassword(ctx, "missing-"+newID(), "scrypt:x", later); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing id: err=%v, want ErrNotFound", err)
	}
}
