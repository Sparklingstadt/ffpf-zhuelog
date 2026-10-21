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

func TestCreateAndListPasswordAccounts(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	now := fixedNow()

	mk := func(login string, at time.Time) AccountSummary {
		a, err := s.CreatePasswordAccount(ctx, login, "名前 "+login, "scrypt:h", at)
		if err != nil {
			t.Fatalf("create %s: %v", login, err)
		}
		t.Cleanup(func() {
			_, _ = s.pool.Exec(context.Background(), `DELETE FROM "PasswordAccount" WHERE id = $1`, a.ID)
		})
		return a
	}
	suffix := newID()
	late := mk("late-"+suffix, now.Add(-time.Hour))
	early := mk("early-"+suffix, now.Add(-48*time.Hour))
	if early.ID == "" || early.ID == late.ID || early.LoginID != "early-"+suffix || early.DisplayName != "名前 early-"+suffix {
		t.Fatalf("created = %+v", early)
	}
	var sv int
	var hash string
	if err := s.pool.QueryRow(ctx, `SELECT "sessionVersion", "passwordHash" FROM "PasswordAccount" WHERE id = $1`, early.ID).Scan(&sv, &hash); err != nil || sv != 0 || hash != "scrypt:h" {
		t.Fatalf("stored sv=%d hash=%q err=%v", sv, hash, err)
	}
	list, err := s.ListPasswordAccounts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got []AccountSummary
	for _, a := range list {
		if a.ID == early.ID || a.ID == late.ID {
			got = append(got, a)
		}
	}
	if len(got) != 2 || got[0].ID != early.ID || got[1].ID != late.ID {
		t.Fatalf("order = %+v", got)
	}
	if !got[0].CreatedAt.Equal(early.CreatedAt) || got[0].CreatedAt.Location() != time.UTC {
		t.Fatalf("createdAt = %v, want %v UTC", got[0].CreatedAt, early.CreatedAt)
	}
}

func TestCreatePasswordAccountDuplicateLoginID(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	login := "dup-" + newID()
	a, err := s.CreatePasswordAccount(ctx, login, "a", "scrypt:h", fixedNow())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "PasswordAccount" WHERE id = $1`, a.ID)
	})
	if _, err := s.CreatePasswordAccount(ctx, login, "b", "scrypt:h", fixedNow()); !errors.Is(err, ErrLoginIDTaken) {
		t.Fatalf("err = %v, want ErrLoginIDTaken", err)
	}
}
