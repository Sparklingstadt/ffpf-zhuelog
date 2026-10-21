package store

import (
	"context"
	"testing"
	"time"
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

func followRows(t *testing.T, s *Store, follower, followee string) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM "Follow" WHERE "followerId" = $1 AND "followeeId" = $2`,
		follower, followee).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func mustFollow(t *testing.T, s *Store, follower, followee string) {
	t.Helper()
	if err := s.Follow(context.Background(), follower, followee, fixedNow()); err != nil {
		t.Fatalf("Follow: %v", err)
	}
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(),
			`DELETE FROM "Follow" WHERE "followerId" = $1 AND "followeeId" = $2`, follower, followee)
	})
}

func TestListMembers(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	viewer := newMember(t, s)
	a := newMember(t, s) // viewer follows, follows back
	b := newMember(t, s) // viewer follows only
	c := newMember(t, s) // follows viewer only
	d := newMember(t, s) // no relation
	mustFollow(t, s, viewer, a)
	mustFollow(t, s, a, viewer)
	mustFollow(t, s, viewer, b)
	mustFollow(t, s, c, viewer)
	mustFollow(t, s, "admin:1", viewer)     // admin follower still counts
	mustFollow(t, s, viewer, "password:zz") // deleted account: not counted

	dir, err := s.ListMembers(ctx, viewer)
	if err != nil {
		t.Fatalf("ListMembers: %v", err)
	}
	byID := map[string]Member{}
	for _, m := range dir.Members {
		byID[m.OwnerID] = m
	}
	if _, ok := byID[viewer]; ok {
		t.Error("viewer must not be listed")
	}
	want := map[string][2]bool{a: {true, true}, b: {true, false}, c: {false, true}, d: {false, false}}
	for id, w := range want {
		m, ok := byID[id]
		if !ok {
			t.Fatalf("member %s missing", id)
		}
		if m.Following != w[0] || m.FollowsMe != w[1] {
			t.Errorf("%s: following=%v followsMe=%v, want %v", id, m.Following, m.FollowsMe, w)
		}
		if m.DisplayName == "" || m.LoginID == "" {
			t.Errorf("%s: empty names %+v", id, m)
		}
	}
	// Other test members may exist in the shared DB but are never followed by
	// the unique viewer, so only a and b count.
	if dir.FollowingCount != 2 {
		t.Errorf("FollowingCount = %d, want 2", dir.FollowingCount)
	}
	if dir.FollowerCount != 3 {
		t.Errorf("FollowerCount = %d, want 3", dir.FollowerCount)
	}
}

func TestListMembersAdminViewer(t *testing.T) {
	s := testStore(t)
	m := newMember(t, s)
	dir, err := s.ListMembers(context.Background(), "admin:42")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, x := range dir.Members {
		if x.OwnerID == m {
			found = true
		}
	}
	if !found || dir.FollowingCount != 0 {
		t.Errorf("found=%v FollowingCount=%d", found, dir.FollowingCount)
	}
}

func TestFollowUnfollow(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := newMember(t, s)
	b := newMember(t, s)

	for i := 0; i < 2; i++ {
		if err := s.Follow(ctx, a, b, fixedNow()); err != nil {
			t.Fatalf("Follow #%d: %v", i, err)
		}
	}
	if n := followRows(t, s, a, b); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
	if err := s.Unfollow(ctx, a, b); err != nil {
		t.Fatal(err)
	}
	if n := followRows(t, s, a, b); n != 0 {
		t.Fatalf("rows after unfollow = %d", n)
	}
	if err := s.Unfollow(ctx, a, b); err != nil {
		t.Fatalf("unfollow of non-followed: %v", err)
	}
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

func shareAll(t *testing.T, s *Store, owner string, es []Entry) {
	t.Helper()
	for _, e := range es {
		if _, err := s.SetShared(context.Background(), owner, e.ID, true, fixedNow()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTimeline(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	viewer := newMember(t, s)
	friend := newMember(t, s)
	stranger := newMember(t, s)
	mustFollow(t, s, viewer, friend)

	t0 := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	mk := func(owner string, n string, at time.Time) Entry {
		_, es, err := s.CreateBatch(ctx, owner, []EntryDraft{draft(n, "h")}, at)
		if err != nil {
			t.Fatal(err)
		}
		return es[0]
	}
	old := mk(friend, "old", t0)
	newer := mk(friend, "new", t0.Add(time.Hour))
	unshared := mk(friend, "unshared", t0.Add(2*time.Hour))
	trashed := mk(friend, "trashed", t0.Add(3*time.Hour))
	strangers := mk(stranger, "stranger", t0.Add(4*time.Hour))
	shareAll(t, s, friend, []Entry{old, newer, trashed})
	shareAll(t, s, stranger, []Entry{strangers})
	if err := s.TrashEntry(ctx, friend, trashed.ID, fixedNow()); err != nil {
		t.Fatal(err)
	}
	_ = unshared

	got, err := s.ListTimeline(ctx, viewer, nil, 10)
	if err != nil {
		t.Fatalf("ListTimeline: %v", err)
	}
	if len(got) != 2 || got[0].Entry.ID != newer.ID || got[1].Entry.ID != old.ID {
		t.Fatalf("got %+v", got)
	}
	if got[0].OwnerID != friend || got[0].OwnerName == "" || got[0].OwnerName == friend {
		t.Errorf("owner = %q / %q", got[0].OwnerID, got[0].OwnerName)
	}
	if len(got[0].Entry.Hints) != 1 || got[0].Entry.Hints[0].Content != "h" {
		t.Errorf("hints = %+v", got[0].Entry.Hints)
	}

	empty, err := s.ListTimeline(ctx, stranger, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Errorf("no follows: got %d items", len(empty))
	}
}

func TestTimelinePaginatesTies(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	viewer := newMember(t, s)
	friend := newMember(t, s)
	mustFollow(t, s, viewer, friend)
	created := createEntries(t, s, friend, 5) // same createdAt
	shareAll(t, s, friend, created)

	seen := map[string]int{}
	var after *Cursor
	for page := 0; page < 10; page++ {
		items, err := s.ListTimeline(ctx, viewer, after, 2)
		if err != nil {
			t.Fatal(err)
		}
		for _, it := range items {
			seen[it.Entry.ID]++
		}
		if len(items) < 2 {
			break
		}
		last := items[len(items)-1].Entry
		after = &Cursor{CreatedAt: last.CreatedAt, ID: last.ID}
	}
	if len(seen) != 5 {
		t.Fatalf("saw %d entries, want 5: %v", len(seen), seen)
	}
	for id, n := range seen {
		if n != 1 {
			t.Errorf("%s seen %d times", id, n)
		}
	}
}

func TestTimelineSkipsDeletedMembers(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	viewer := newMember(t, s)
	friend := newMember(t, s)
	ghost := "password:" + newID() // no PasswordAccount
	t.Cleanup(func() {
		_, _ = s.pool.Exec(ctx, `DELETE FROM "ImportBatch" WHERE id IN (SELECT "batchId" FROM "LearningEntry" WHERE "ownerId" = $1)`, ghost)
	})
	mustFollow(t, s, viewer, friend)
	mustFollow(t, s, viewer, ghost)

	ghosts := createEntries(t, s, ghost, 3)
	shareAll(t, s, ghost, ghosts)
	_, es, err := s.CreateBatch(ctx, friend, []EntryDraft{draft("1"), draft("2")}, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	shareAll(t, s, friend, es)

	got, err := s.ListTimeline(ctx, viewer, nil, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d items, want 2", len(got))
	}
	for _, it := range got {
		if it.OwnerID != friend {
			t.Errorf("item from %s", it.OwnerID)
		}
	}
}
