package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestFfpfOwnerID(t *testing.T) {
	if got := FfpfOwnerID("abc123"); got != "ffpf:abc123" {
		t.Fatalf("FfpfOwnerID = %q, want ffpf:abc123", got)
	}
}

// cleanupFfpfAccount removes the row when the test ends.
func cleanupFfpfAccount(t *testing.T, s *Store, id string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "FfpfAccount" WHERE id = $1`, id)
	})
}

func TestUpsertFfpfAccount(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id := "t" + newID()
	cleanupFfpfAccount(t, s, id)
	t1 := time.Date(2026, 10, 27, 1, 2, 3, 0, time.UTC)
	t2 := t1.Add(time.Hour)

	got, err := s.UpsertFfpfAccount(ctx, FfpfAccount{ID: id, Email: "a@example.com", DisplayName: "A"}, t1)
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if want := (FfpfAccount{ID: id, Email: "a@example.com", DisplayName: "A", SessionVersion: 0}); got != want {
		t.Fatalf("first upsert = %+v, want %+v", got, want)
	}

	// Bump sessionVersion by hand: a later login must not reset it.
	if _, err := s.pool.Exec(ctx, `UPDATE "FfpfAccount" SET "sessionVersion" = 3 WHERE id = $1`, id); err != nil {
		t.Fatalf("set sessionVersion: %v", err)
	}
	var createdBefore time.Time
	if err := s.pool.QueryRow(ctx, `SELECT "createdAt" FROM "FfpfAccount" WHERE id = $1`, id).Scan(&createdBefore); err != nil {
		t.Fatalf("read createdAt: %v", err)
	}

	got, err = s.UpsertFfpfAccount(ctx, FfpfAccount{ID: id, Email: "b@example.com", DisplayName: "B"}, t2)
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if want := (FfpfAccount{ID: id, Email: "b@example.com", DisplayName: "B", SessionVersion: 3}); got != want {
		t.Fatalf("second upsert = %+v, want %+v", got, want)
	}

	var n int
	var createdAfter, lastLogin time.Time
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM "FfpfAccount" WHERE id = $1`, id).Scan(&n); err != nil || n != 1 {
		t.Fatalf("rows = %d, %v; want 1", n, err)
	}
	if err := s.pool.QueryRow(ctx,
		`SELECT "createdAt", "lastLoginAt" FROM "FfpfAccount" WHERE id = $1`, id).Scan(&createdAfter, &lastLogin); err != nil {
		t.Fatalf("read times: %v", err)
	}
	if !createdAfter.Equal(createdBefore) {
		t.Fatalf("createdAt changed: %v -> %v", createdBefore, createdAfter)
	}
	if !lastLogin.Equal(dbTime(t2)) {
		t.Fatalf("lastLoginAt = %v, want %v", lastLogin, dbTime(t2))
	}
}

func TestFindFfpfAccountAndSessionVersion(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id := "t" + newID()
	cleanupFfpfAccount(t, s, id)
	want, err := s.UpsertFfpfAccount(ctx, FfpfAccount{ID: id, Email: "a@example.com", DisplayName: "A"}, time.Now())
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got, err := s.FindFfpfAccount(ctx, id)
	if err != nil || got != want {
		t.Fatalf("FindFfpfAccount = %+v, %v; want %+v", got, err, want)
	}
	v, err := s.FfpfSessionVersion(ctx, id)
	if err != nil || v != 0 {
		t.Fatalf("FfpfSessionVersion = %d, %v; want 0", v, err)
	}

	missing := "missing" + newID()
	if _, err := s.FindFfpfAccount(ctx, missing); !errors.Is(err, ErrNotFound) {
		t.Fatalf("FindFfpfAccount missing: err=%v, want ErrNotFound", err)
	}
	if _, err := s.FfpfSessionVersion(ctx, missing); !errors.Is(err, ErrNotFound) {
		t.Fatalf("FfpfSessionVersion missing: err=%v, want ErrNotFound", err)
	}
}
