package store

import (
	"context"
	"errors"
	"sort"
	"testing"
	"time"
)

func createAt(t *testing.T, s *Store, owner string, at time.Time, n int) []Entry {
	t.Helper()
	drafts := make([]EntryDraft, n)
	for i := range drafts {
		drafts[i] = draft(string(rune('a'+i)), "h0")
	}
	return createTied(t, s, owner, drafts, at)
}

func TestListLogDates(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)

	createAt(t, s, owner, time.Date(2026, 10, 19, 3, 0, 0, 0, time.UTC), 1)
	createAt(t, s, owner, time.Date(2026, 10, 21, 1, 0, 0, 0, time.UTC), 2)
	createAt(t, s, owner, time.Date(2026, 10, 21, 5, 0, 0, 0, time.UTC), 1)
	trashed := createAt(t, s, owner, time.Date(2026, 10, 20, 3, 0, 0, 0, time.UTC), 1)
	createAt(t, s, other, time.Date(2026, 10, 18, 3, 0, 0, 0, time.UTC), 1)
	if err := s.TrashEntry(ctx, owner, trashed[0].ID, fixedNow()); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListLogDates(ctx, owner)
	if err != nil {
		t.Fatalf("ListLogDates: %v", err)
	}
	want := []LogDateCount{
		{LogDate{2026, 10, 21}, 3},
		{LogDate{2026, 10, 19}, 1},
	}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %+v, want %+v", got, want)
	}

	empty, err := s.ListLogDates(ctx, newOwner(t, s))
	if err != nil || empty == nil || len(empty) != 0 {
		t.Errorf("empty = %#v, %v; want non-nil empty", empty, err)
	}
}

func TestLogDatesJSTBoundary(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)

	before := time.Date(2026, 10, 20, 14, 59, 59, 999_000_000, time.UTC) // 10/20 23:59:59.999 JST
	after := time.Date(2026, 10, 20, 15, 0, 0, 0, time.UTC)              // 10/21 00:00:00.000 JST
	b := createAt(t, s, owner, before, 1)
	a := createAt(t, s, owner, after, 1)

	dates, err := s.ListLogDates(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	want := []LogDateCount{{LogDate{2026, 10, 21}, 1}, {LogDate{2026, 10, 20}, 1}}
	if len(dates) != 2 || dates[0] != want[0] || dates[1] != want[1] {
		t.Fatalf("dates = %+v, want %+v", dates, want)
	}

	d20, err := s.ListDailyEntries(ctx, owner, LogDate{2026, 10, 20})
	if err != nil || len(d20) != 1 || d20[0].ID != b[0].ID {
		t.Fatalf("10/20 = %+v, %v", d20, err)
	}
	d21, err := s.ListDailyEntries(ctx, owner, LogDate{2026, 10, 21})
	if err != nil || len(d21) != 1 || d21[0].ID != a[0].ID {
		t.Fatalf("10/21 = %+v, %v", d21, err)
	}
}

func TestListDailyEntries(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)

	day := LogDate{2026, 10, 21}
	early := createAt(t, s, owner, time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC), 1)
	tied := createAt(t, s, owner, time.Date(2026, 10, 21, 2, 0, 0, 0, time.UTC), 3)
	late := createAt(t, s, owner, time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC), 1)
	createAt(t, s, owner, time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC), 1)
	createAt(t, s, other, time.Date(2026, 10, 21, 3, 0, 0, 0, time.UTC), 1)
	gone := createAt(t, s, owner, time.Date(2026, 10, 21, 4, 0, 0, 0, time.UTC), 1)
	if err := s.TrashEntry(ctx, owner, gone[0].ID, fixedNow()); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListDailyEntries(ctx, owner, day)
	if err != nil {
		t.Fatalf("ListDailyEntries: %v", err)
	}
	ids := []string{tied[0].ID, tied[1].ID, tied[2].ID}
	sort.Strings(ids)
	want := append(append([]string{early[0].ID}, ids...), late[0].ID)
	if len(got) != len(want) {
		t.Fatalf("got %d entries, want %d", len(got), len(want))
	}
	for i, id := range want {
		if got[i].ID != id {
			t.Errorf("entry %d = %s, want %s", i, got[i].ID, id)
		}
		if len(got[i].Hints) != 1 || got[i].Hints[0].Content != "h0" {
			t.Errorf("entry %d hints = %+v", i, got[i].Hints)
		}
	}

	none, err := s.ListDailyEntries(ctx, owner, LogDate{2026, 1, 1})
	if err != nil || none == nil || len(none) != 0 {
		t.Errorf("none = %#v, %v; want non-nil empty", none, err)
	}
}

func TestGetDailyEntry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	day := LogDate{2026, 10, 21}

	first := createAt(t, s, owner, time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC), 1)
	mid := createAt(t, s, owner, time.Date(2026, 10, 21, 2, 0, 0, 0, time.UTC), 1)
	last := createAt(t, s, owner, time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC), 1)

	e, total, err := s.GetDailyEntry(ctx, owner, day, 1)
	if err != nil || e.ID != first[0].ID || total != 3 {
		t.Fatalf("n=1: %+v total=%d err=%v", e, total, err)
	}
	if len(e.Hints) != 1 {
		t.Errorf("hints = %+v", e.Hints)
	}
	e, total, err = s.GetDailyEntry(ctx, owner, day, 3)
	if err != nil || e.ID != last[0].ID || total != 3 {
		t.Fatalf("n=3: %+v total=%d err=%v", e, total, err)
	}
	for _, n := range []int{0, -1, 4} {
		if _, _, err := s.GetDailyEntry(ctx, owner, day, n); !errors.Is(err, ErrNotFound) {
			t.Errorf("n=%d err = %v, want ErrNotFound", n, err)
		}
	}
	if _, _, err := s.GetDailyEntry(ctx, newOwner(t, s), day, 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("other owner err = %v", err)
	}

	if err := s.TrashEntry(ctx, owner, first[0].ID, fixedNow()); err != nil {
		t.Fatal(err)
	}
	e, total, err = s.GetDailyEntry(ctx, owner, day, 1)
	if err != nil || e.ID != mid[0].ID || total != 2 {
		t.Fatalf("after trash n=1: %+v total=%d err=%v", e, total, err)
	}
	if _, _, err := s.GetDailyEntry(ctx, owner, day, 3); !errors.Is(err, ErrNotFound) {
		t.Errorf("n=3 after trash err = %v", err)
	}
}
