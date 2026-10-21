package store

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"testing"
	"time"
)

func TestListTrashed(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)

	mine := createEntries(t, s, owner, fixedNow(), 3, 2)
	theirs := createEntries(t, s, other, fixedNow(), 1, 2)
	t1 := time.Date(2026, 10, 21, 1, 0, 0, 0, time.UTC)
	t2 := t1.Add(time.Hour)
	if err := s.TrashEntry(ctx, owner, mine[0].ID, t1); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashEntry(ctx, owner, mine[1].ID, t2); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashEntry(ctx, other, theirs[0].ID, t2); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListTrashed(ctx, owner, nil, 10)
	if err != nil {
		t.Fatalf("ListTrashed: %v", err)
	}
	if len(got) != 2 || got[0].ID != mine[1].ID || got[1].ID != mine[0].ID {
		t.Fatalf("got %+v, want [%s %s]", got, mine[1].ID, mine[0].ID)
	}
	if !got[0].DeletedAt.Equal(t2) || !got[1].DeletedAt.Equal(t1) {
		t.Errorf("DeletedAt = %v, %v", got[0].DeletedAt, got[1].DeletedAt)
	}
	if len(got[0].Hints) != 2 || got[0].Hints[0].Content != "h0" || got[0].Hints[1].Content != "h1" {
		t.Errorf("hints = %+v", got[0].Hints)
	}
}

func TestListTrashedPaginatesTies(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	created := createEntries(t, s, owner, fixedNow(), 5, 2)
	at := time.Date(2026, 10, 21, 1, 0, 0, 0, time.UTC)
	for _, e := range created {
		if err := s.TrashEntry(ctx, owner, e.ID, at); err != nil {
			t.Fatal(err)
		}
	}

	var seen []string
	var cur *Cursor
	for page := 0; page < 10; page++ {
		got, err := s.ListTrashed(ctx, owner, cur, 2)
		if err != nil {
			t.Fatalf("page %d: %v", page, err)
		}
		if len(got) == 0 {
			break
		}
		for _, e := range got {
			seen = append(seen, e.ID)
		}
		last := got[len(got)-1]
		cur = &Cursor{CreatedAt: last.DeletedAt, ID: last.ID}
	}
	var want []string
	for _, e := range created {
		want = append(want, e.ID)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(want)))
	if !reflect.DeepEqual(seen, want) {
		t.Errorf("seen = %v, want %v", seen, want)
	}
}

func TestRestoreEntry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	e := createEntries(t, s, owner, fixedNow(), 1, 2)[0]
	shareAt := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)

	if _, err := s.RestoreEntry(ctx, owner, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("restore of non-trashed: err = %v, want ErrNotFound", err)
	}
	if _, err := s.SetShared(ctx, owner, e.ID, true, shareAt); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashEntry(ctx, owner, e.ID, shareAt.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	got, err := s.RestoreEntry(ctx, owner, e.ID)
	if err != nil {
		t.Fatalf("RestoreEntry: %v", err)
	}
	if got.ID != e.ID || len(got.Hints) != 2 || got.SharedAt == nil || !got.SharedAt.Equal(shareAt) {
		t.Errorf("restored = %+v", got)
	}
	if _, err := s.GetEntry(ctx, owner, e.ID); err != nil {
		t.Errorf("GetEntry after restore: %v", err)
	}
	if _, err := s.RestoreEntry(ctx, owner, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second restore: err = %v, want ErrNotFound", err)
	}
}

func TestPurgeEntry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	e := createEntries(t, s, owner, fixedNow(), 1, 2)[0]

	if err := s.PurgeEntry(ctx, owner, e.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("purge of non-trashed: err = %v, want ErrNotFound", err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM "LearningEntry" WHERE id = $1`, e.ID); n != 1 {
		t.Fatalf("entry removed by failed purge")
	}
	if err := s.TrashEntry(ctx, owner, e.ID, fixedNow()); err != nil {
		t.Fatal(err)
	}
	if err := s.PurgeEntry(ctx, owner, e.ID); err != nil {
		t.Fatalf("PurgeEntry: %v", err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM "LearningEntry" WHERE id = $1`, e.ID); n != 0 {
		t.Errorf("entry rows = %d, want 0", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM "Hint" WHERE "learningEntryId" = $1`, e.ID); n != 0 {
		t.Errorf("hint rows = %d, want 0", n)
	}
	if err := s.PurgeEntry(ctx, owner, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second purge: err = %v, want ErrNotFound", err)
	}
}

func TestEmptyTrash(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)
	mine := createEntries(t, s, owner, fixedNow(), 3, 2)
	theirs := createEntries(t, s, other, fixedNow(), 1, 2)
	for _, e := range mine[:2] {
		if err := s.TrashEntry(ctx, owner, e.ID, fixedNow()); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.TrashEntry(ctx, other, theirs[0].ID, fixedNow()); err != nil {
		t.Fatal(err)
	}

	n, err := s.EmptyTrash(ctx, owner)
	if err != nil || n != 2 {
		t.Fatalf("EmptyTrash = %d, %v; want 2, nil", n, err)
	}
	if _, err := s.GetEntry(ctx, owner, mine[2].ID); err != nil {
		t.Errorf("non-trashed entry gone: %v", err)
	}
	if c := countRows(t, s, `SELECT count(*) FROM "LearningEntry" WHERE id = $1`, theirs[0].ID); c != 1 {
		t.Errorf("other owner's trashed entry removed")
	}
	if n, err := s.EmptyTrash(ctx, owner); err != nil || n != 0 {
		t.Errorf("second EmptyTrash = %d, %v; want 0, nil", n, err)
	}
}

func TestSetShared(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	e := createEntries(t, s, owner, fixedNow(), 1, 2)[0]
	first := time.Date(2026, 10, 21, 1, 2, 3, 456_000_000, time.UTC)

	got, err := s.SetShared(ctx, owner, e.ID, true, first)
	if err != nil || got.SharedAt == nil || !got.SharedAt.Equal(first) {
		t.Fatalf("share = %+v, %v; want sharedAt %v", got, err, first)
	}
	if len(got.Hints) != 2 {
		t.Errorf("hints = %+v", got.Hints)
	}
	got, err = s.SetShared(ctx, owner, e.ID, true, first.Add(time.Hour))
	if err != nil || got.SharedAt == nil || !got.SharedAt.Equal(first) {
		t.Fatalf("re-share = %+v, %v; want sharedAt kept %v", got, err, first)
	}
	got, err = s.SetShared(ctx, owner, e.ID, false, first)
	if err != nil || got.SharedAt != nil {
		t.Fatalf("unshare = %+v, %v; want nil sharedAt", got, err)
	}
	got, err = s.SetShared(ctx, owner, e.ID, false, first)
	if err != nil || got.SharedAt != nil {
		t.Fatalf("unshare of unshared = %+v, %v; want success", got, err)
	}

	if err := s.TrashEntry(ctx, owner, e.ID, first); err != nil {
		t.Fatal(err)
	}
	for _, shared := range []bool{true, false} {
		if _, err := s.SetShared(ctx, owner, e.ID, shared, first); !errors.Is(err, ErrNotFound) {
			t.Errorf("trashed shared=%v: err = %v, want ErrNotFound", shared, err)
		}
	}
}

func TestTrashOpsAreOwnerScoped(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)
	mine := createEntries(t, s, owner, fixedNow(), 2, 2)
	trashed, live := mine[0], mine[1]
	if err := s.TrashEntry(ctx, owner, trashed.ID, fixedNow()); err != nil {
		t.Fatal(err)
	}

	if _, err := s.RestoreEntry(ctx, other, trashed.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("restore: err = %v", err)
	}
	if err := s.PurgeEntry(ctx, other, trashed.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("purge: err = %v", err)
	}
	if _, err := s.SetShared(ctx, other, live.ID, true, fixedNow()); !errors.Is(err, ErrNotFound) {
		t.Errorf("share: err = %v", err)
	}
	if n, err := s.EmptyTrash(ctx, other); err != nil || n != 0 {
		t.Errorf("empty trash = %d, %v", n, err)
	}

	if c := countRows(t, s, `SELECT count(*) FROM "LearningEntry" WHERE id = $1 AND "deletedAt" IS NOT NULL`, trashed.ID); c != 1 {
		t.Errorf("trashed entry changed")
	}
	if c := countRows(t, s, `SELECT count(*) FROM "LearningEntry" WHERE id = $1 AND "sharedAt" IS NULL`, live.ID); c != 1 {
		t.Errorf("live entry shared by other owner")
	}
}
