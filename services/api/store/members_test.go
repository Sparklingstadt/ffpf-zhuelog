package store

import (
	"context"
	"testing"
)

// newMember inserts a PasswordAccount and returns its ownerId ("password:<id>").
// The account and every follow row touching it are removed when the test ends.
func newMember(t *testing.T, s *Store) string {
	t.Helper()
	acc := newAccount(t, s)
	owner := "password:" + acc.ID
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(),
			`DELETE FROM "Follow" WHERE "followerId" = $1 OR "followeeId" = $1`, owner)
	})
	return owner
}

func TestMemberExists(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	m := newMember(t, s)
	acc := m[len("password:"):]
	for id, want := range map[string]bool{
		m:                  true,
		"password:nope123": false,
		acc:                false, // no prefix
		"admin:1":          false,
		"":                 false,
	} {
		got, err := s.MemberExists(ctx, id)
		if err != nil {
			t.Fatalf("MemberExists(%q): %v", id, err)
		}
		if got != want {
			t.Errorf("MemberExists(%q) = %v, want %v", id, got, want)
		}
	}
}

// newFfpfMember inserts an FfpfAccount with the given display name and returns
// its ownerId ("ffpf:<sub>"). The account and every follow row touching it are
// removed when the test ends.
func newFfpfMember(t *testing.T, s *Store, name string) string {
	t.Helper()
	sub := "t" + newID()
	if _, err := s.UpsertFfpfAccount(context.Background(),
		FfpfAccount{ID: sub, Email: sub + "@example.com", DisplayName: name}, fixedNow()); err != nil {
		t.Fatalf("UpsertFfpfAccount: %v", err)
	}
	cleanupFfpfAccount(t, s, sub)
	owner := FfpfOwnerID(sub)
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(),
			`DELETE FROM "Follow" WHERE "followerId" = $1 OR "followeeId" = $1`, owner)
	})
	return owner
}

func TestMemberExistsFfpf(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	m := newFfpfMember(t, s, "F")
	for id, want := range map[string]bool{
		m:                   true,
		"ffpf:nope123":      false,
		"ffpf:":             false,
		m[len("ffpf:"):]:    false, // no prefix
		"password:" + m[5:]: false, // the sub is not a password account
	} {
		got, err := s.MemberExists(ctx, id)
		if err != nil {
			t.Fatalf("MemberExists(%q): %v", id, err)
		}
		if got != want {
			t.Errorf("MemberExists(%q) = %v, want %v", id, got, want)
		}
	}
}
