package store

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// newTokenOwner returns a fresh owner and removes its refresh tokens when the
// test ends.
func newTokenOwner(t *testing.T, s *Store) string {
	t.Helper()
	owner := "password:" + newID()
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "ApiRefreshToken" WHERE "ownerId" = $1`, owner)
	})
	return owner
}

func intp(v int) *int { return &v }

func countTokens(t *testing.T, s *Store, owner string) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM "ApiRefreshToken" WHERE "ownerId" = $1`, owner).Scan(&n); err != nil {
		t.Fatalf("count tokens: %v", err)
	}
	return n
}

func TestRefreshTokenRoundTrip(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newTokenOwner(t, s)
	now := fixedNow()

	cases := []RefreshToken{
		{ID: newID(), OwnerID: owner, Role: "member", SessionVersion: intp(3), FamilyID: newID(), ExpiresAt: now.Add(time.Hour)},
		{ID: newID(), OwnerID: owner, Role: "admin", Login: "Alice", SessionVersion: nil, FamilyID: newID(), ExpiresAt: now.Add(2 * time.Hour)},
	}
	for _, want := range cases {
		hash := "hash-" + want.ID
		if err := s.InsertRefreshToken(ctx, want, hash); err != nil {
			t.Fatalf("Insert: %v", err)
		}
		got, err := s.FindRefreshToken(ctx, hash)
		if err != nil {
			t.Fatalf("Find: %v", err)
		}
		if got.ID != want.ID || got.OwnerID != want.OwnerID || got.Role != want.Role || got.Login != want.Login || got.FamilyID != want.FamilyID {
			t.Fatalf("got %+v, want %+v", got, want)
		}
		if (got.SessionVersion == nil) != (want.SessionVersion == nil) ||
			(want.SessionVersion != nil && *got.SessionVersion != *want.SessionVersion) {
			t.Fatalf("SessionVersion got %v, want %v", got.SessionVersion, want.SessionVersion)
		}
		if !got.ExpiresAt.Equal(want.ExpiresAt) || got.RevokedAt != nil {
			t.Fatalf("ExpiresAt=%v RevokedAt=%v, want %v and nil", got.ExpiresAt, got.RevokedAt, want.ExpiresAt)
		}
	}

	// Rotation carries the admin login into the new row.
	admin := cases[1]
	nextAdmin := RefreshToken{ID: newID(), OwnerID: owner, Role: "admin", Login: admin.Login, FamilyID: admin.FamilyID, ExpiresAt: now.Add(3 * time.Hour)}
	if ok, err := s.RotateRefreshToken(ctx, admin.ID, nextAdmin, "hash-"+nextAdmin.ID, now); err != nil || !ok {
		t.Fatalf("Rotate admin: ok=%v err=%v", ok, err)
	}
	if got, err := s.FindRefreshToken(ctx, "hash-"+nextAdmin.ID); err != nil || got.Login != "Alice" {
		t.Fatalf("rotated admin = %+v, %v; want Login Alice", got, err)
	}

	if _, err := s.FindRefreshToken(ctx, "missing-"+newID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing hash: err=%v, want ErrNotFound", err)
	}

	// An empty ID is generated.
	noID := RefreshToken{OwnerID: owner, Role: "member", FamilyID: newID(), ExpiresAt: now.Add(time.Hour)}
	if err := s.InsertRefreshToken(ctx, noID, "hash-noid-"+newID()); err != nil {
		t.Fatalf("Insert without ID: %v", err)
	}
	if n := countTokens(t, s, owner); n != 4 {
		t.Fatalf("token count = %d, want 4", n)
	}
}

func TestRotateRefreshToken(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newTokenOwner(t, s)
	now := fixedNow()
	family := newID()

	old := RefreshToken{ID: newID(), OwnerID: owner, Role: "member", SessionVersion: intp(1), FamilyID: family, ExpiresAt: now.Add(time.Hour)}
	if err := s.InsertRefreshToken(ctx, old, "old-hash-"+old.ID); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	next := RefreshToken{ID: newID(), OwnerID: owner, Role: "member", SessionVersion: intp(1), FamilyID: family, ExpiresAt: now.Add(2 * time.Hour)}

	ok, err := s.RotateRefreshToken(ctx, old.ID, next, "next-hash-"+next.ID, now)
	if err != nil || !ok {
		t.Fatalf("first rotate: ok=%v err=%v, want true", ok, err)
	}
	gotOld, err := s.FindRefreshToken(ctx, "old-hash-"+old.ID)
	if err != nil {
		t.Fatalf("Find old: %v", err)
	}
	if gotOld.RevokedAt == nil || !gotOld.RevokedAt.Equal(now) {
		t.Fatalf("old RevokedAt = %v, want %v", gotOld.RevokedAt, now)
	}
	gotNext, err := s.FindRefreshToken(ctx, "next-hash-"+next.ID)
	if err != nil || gotNext.ID != next.ID || gotNext.RevokedAt != nil || gotNext.FamilyID != family {
		t.Fatalf("Find next = %+v, %v", gotNext, err)
	}

	again := RefreshToken{ID: newID(), OwnerID: owner, Role: "member", FamilyID: family, ExpiresAt: now.Add(2 * time.Hour)}
	ok, err = s.RotateRefreshToken(ctx, old.ID, again, "again-hash-"+again.ID, now)
	if err != nil || ok {
		t.Fatalf("second rotate: ok=%v err=%v, want false", ok, err)
	}
	if n := countTokens(t, s, owner); n != 2 {
		t.Fatalf("token count = %d, want 2", n)
	}
}

func TestRotateRefreshTokenConcurrent(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newTokenOwner(t, s)
	now := fixedNow()
	family := newID()

	old := RefreshToken{ID: newID(), OwnerID: owner, Role: "member", FamilyID: family, ExpiresAt: now.Add(time.Hour)}
	if err := s.InsertRefreshToken(ctx, old, "old-hash-"+old.ID); err != nil {
		t.Fatalf("Insert: %v", err)
	}

	const n = 10
	var wins atomic.Int32
	var wg sync.WaitGroup
	errs := make(chan error, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			next := RefreshToken{ID: newID(), OwnerID: owner, Role: "member", FamilyID: family, ExpiresAt: now.Add(2 * time.Hour)}
			<-start
			ok, err := s.RotateRefreshToken(ctx, old.ID, next, "next-hash-"+next.ID, now)
			if err != nil {
				errs <- err
				return
			}
			if ok {
				wins.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("rotate: %v", err)
	}
	if got := wins.Load(); got != 1 {
		t.Fatalf("winners = %d, want exactly 1", got)
	}
	if got := countTokens(t, s, owner); got != 2 {
		t.Fatalf("token count = %d, want 2 (old + one next)", got)
	}
}

func TestRevokeFamilyAndPrune(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newTokenOwner(t, s)
	other := newTokenOwner(t, s)
	now := fixedNow()
	family := newID()

	insert := func(owner, family string, expires time.Time) RefreshToken {
		tok := RefreshToken{ID: newID(), OwnerID: owner, Role: "member", FamilyID: family, ExpiresAt: expires}
		if err := s.InsertRefreshToken(ctx, tok, "hash-"+tok.ID); err != nil {
			t.Fatalf("Insert: %v", err)
		}
		return tok
	}
	a := insert(owner, family, now.Add(time.Hour))
	b := insert(owner, family, now.Add(time.Hour))
	live := insert(owner, newID(), now.Add(time.Hour))
	expired := insert(owner, newID(), now.Add(-time.Hour))
	foreignExpired := insert(other, newID(), now.Add(-time.Hour))

	if err := s.RevokeFamily(ctx, family, now); err != nil {
		t.Fatalf("RevokeFamily: %v", err)
	}
	for _, tok := range []RefreshToken{a, b} {
		got, err := s.FindRefreshToken(ctx, "hash-"+tok.ID)
		if err != nil || got.RevokedAt == nil || !got.RevokedAt.Equal(now) {
			t.Fatalf("family token %s: %+v, %v; want revoked at %v", tok.ID, got, err, now)
		}
	}
	got, err := s.FindRefreshToken(ctx, "hash-"+live.ID)
	if err != nil || got.RevokedAt != nil {
		t.Fatalf("live token revoked unexpectedly: %+v, %v", got, err)
	}

	if err := s.PruneRefreshTokens(ctx, owner, now); err != nil {
		t.Fatalf("Prune: %v", err)
	}
	for _, gone := range []RefreshToken{a, b, expired} {
		if _, err := s.FindRefreshToken(ctx, "hash-"+gone.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("token %s should be pruned, err=%v", gone.ID, err)
		}
	}
	if _, err := s.FindRefreshToken(ctx, "hash-"+live.ID); err != nil {
		t.Fatalf("live token should remain: %v", err)
	}
	if _, err := s.FindRefreshToken(ctx, "hash-"+foreignExpired.ID); err != nil {
		t.Fatalf("other owner's token should remain: %v", err)
	}
}
