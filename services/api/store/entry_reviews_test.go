package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// dueEntryItem is the owner's due "entry" item of note id, or nil.
func dueEntryItem(t *testing.T, s *Store, owner, id string, at time.Time) *ReviewItem {
	t.Helper()
	due, err := s.ListDueReviewItems(context.Background(), owner, at, 100)
	if err != nil {
		t.Fatal(err)
	}
	for i := range due {
		if due[i].Kind == ReviewKindEntry && due[i].TargetID == id {
			return &due[i]
		}
	}
	return nil
}

func TestAddEntryReviewAddsOnceAndRemoveTakesTheCard(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	note := createEntries(t, s, a, now.Add(-time.Hour), 1, 2)[0]

	if in, err := s.EntryInReview(ctx, a, note.ID); err != nil || in {
		t.Fatalf("before = %v, %v", in, err)
	}
	if err := s.AddEntryReview(ctx, a, note.ID, now); err != nil {
		t.Fatal(err)
	}
	if in, err := s.EntryInReview(ctx, a, note.ID); err != nil || !in {
		t.Fatalf("after add = %v, %v", in, err)
	}
	it := dueEntryItem(t, s, a, note.ID, now)
	if it == nil || it.Language != "zh" || !it.Due.Equal(dbTime(now)) || it.State != review.New || it.Reps != 0 || it.Vocabulary != nil {
		t.Fatalf("due item = %+v", it)
	}
	if it.Entry == nil || it.Entry.ID != note.ID || it.Entry.CorrectedText != note.CorrectedText || len(it.Entry.Hints) != 2 ||
		it.Entry.Hints[1].Content != "h1" || !it.Entry.CreatedAt.Equal(note.CreatedAt) {
		t.Fatalf("attached note = %+v, want %+v", it.Entry, note)
	}
	if n, err := s.CountDueReviewItems(ctx, a, now); err != nil || n != 1 {
		t.Fatalf("count = %d, %v", n, err)
	}

	// Adding it again keeps the card as it is.
	logID := newUUID()
	answered, err := s.RecordReview(ctx, a, it.ID, logID, review.Good, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AddEntryReview(ctx, a, note.ID, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	later := answered.Due.Add(time.Second)
	again := dueEntryItem(t, s, a, note.ID, later)
	if again == nil || again.ID != it.ID || !again.Due.Equal(answered.Due) || again.Reps != 1 || again.State != answered.State {
		t.Fatalf("added again = %+v, was %+v", again, answered)
	}
	if n := countRows(t, s, `SELECT count(*) FROM "ReviewItem" WHERE "ownerId" = $1`, a); n != 1 {
		t.Fatalf("items = %d", n)
	}

	if err := s.RemoveEntryReview(ctx, a, note.ID); err != nil {
		t.Fatal(err)
	}
	if in, err := s.EntryInReview(ctx, a, note.ID); err != nil || in {
		t.Errorf("after remove = %v, %v", in, err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM "ReviewItem" WHERE "id" = $1`, it.ID); n != 0 {
		t.Errorf("item left after remove")
	}
	if n := countRows(t, s, `SELECT count(*) FROM "ReviewLog" WHERE "id" = $1`, logID); n != 0 {
		t.Errorf("log left after remove")
	}
	// Removing a note that is not in review succeeds.
	if err := s.RemoveEntryReview(ctx, a, note.ID); err != nil {
		t.Errorf("second remove: %v", err)
	}
	// Added back, it starts over.
	if err := s.AddEntryReview(ctx, a, note.ID, later); err != nil {
		t.Fatal(err)
	}
	if back := dueEntryItem(t, s, a, note.ID, later); back == nil || back.ID == it.ID || back.Reps != 0 || back.State != review.New {
		t.Errorf("added back = %+v", back)
	}
}

func TestEntryReviewIsOnlyForTheOwnersNotesOutOfTheTrash(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := reviewOwner(t, s), reviewOwner(t, s)
	now := fixedNow()
	notes := createEntries(t, s, a, now.Add(-time.Hour), 2, 0)
	mine, trashed := notes[0].ID, notes[1].ID
	if err := s.AddEntryReview(ctx, a, mine, now); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashEntry(ctx, a, trashed, now); err != nil {
		t.Fatal(err)
	}

	for name, tc := range map[string]struct{ owner, id string }{
		"another owner's": {b, mine},
		"unknown":         {a, newID()},
		"in the trash":    {a, trashed},
	} {
		if _, err := s.EntryInReview(ctx, tc.owner, tc.id); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s status: %v", name, err)
		}
		if err := s.AddEntryReview(ctx, tc.owner, tc.id, now); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s add: %v", name, err)
		}
		if err := s.RemoveEntryReview(ctx, tc.owner, tc.id); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s remove: %v", name, err)
		}
	}
	if n := countRows(t, s, `SELECT count(*) FROM "ReviewItem" WHERE "ownerId" = ANY($1)`, []string{a, b}); n != 1 {
		t.Errorf("items = %d, want only the one added", n)
	}
	if in, err := s.EntryInReview(ctx, a, mine); err != nil || !in {
		t.Errorf("another owner's remove touched the card: %v, %v", in, err)
	}
}

func TestATrashedNoteLeavesTheReviewUntilRestored(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	notes := createEntries(t, s, a, now.Add(-time.Hour), 2, 0)
	if _, err := s.EnqueueReviewItems(ctx, a, []ReviewTarget{target("complement", "result-01")}, now); err != nil {
		t.Fatal(err)
	}
	for _, n := range notes {
		if err := s.AddEntryReview(ctx, a, n.ID, now); err != nil {
			t.Fatal(err)
		}
	}
	it := dueEntryItem(t, s, a, notes[0].ID, now)
	answered, err := s.RecordReview(ctx, a, it.ID, newUUID(), review.Good, now)
	if err != nil {
		t.Fatal(err)
	}
	later := answered.Due.Add(time.Second)
	if n, _ := s.CountDueReviewItems(ctx, a, later); n != 3 {
		t.Fatalf("count before trash = %d", n)
	}

	if err := s.TrashEntry(ctx, a, notes[0].ID, later); err != nil {
		t.Fatal(err)
	}
	due, err := s.ListDueReviewItems(ctx, a, later, 100)
	if err != nil || len(due) != 2 {
		t.Fatalf("due while trashed = %+v, %v", due, err)
	}
	for _, d := range due {
		if d.TargetID == notes[0].ID {
			t.Errorf("trashed note listed: %+v", d)
		}
	}
	if n, err := s.CountDueReviewItems(ctx, a, later); err != nil || n != 2 {
		t.Errorf("count while trashed = %d, %v", n, err)
	}
	// The limit counts only what is listed.
	if due, _ := s.ListDueReviewItems(ctx, a, later, 2); len(due) != 2 {
		t.Errorf("limit 2 while trashed = %+v", due)
	}

	if _, err := s.RestoreEntry(ctx, a, notes[0].ID); err != nil {
		t.Fatal(err)
	}
	back := dueEntryItem(t, s, a, notes[0].ID, later)
	if back == nil || back.ID != it.ID || back.Reps != 1 || back.State != answered.State ||
		back.Stability != answered.Stability || !back.Due.Equal(answered.Due) || back.Entry == nil {
		t.Fatalf("restored = %+v, was %+v", back, answered)
	}
	if n, _ := s.CountDueReviewItems(ctx, a, later); n != 3 {
		t.Errorf("count after restore = %d", n)
	}
}

func TestDeletingANoteForGoodDeletesItsReviewItem(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	notes := createEntries(t, s, a, now.Add(-time.Hour), 4, 1)
	logs := map[string]string{}
	for _, n := range notes {
		if err := s.AddEntryReview(ctx, a, n.ID, now); err != nil {
			t.Fatal(err)
		}
		it := dueEntryItem(t, s, a, n.ID, now)
		logs[n.ID] = newUUID()
		if _, err := s.RecordReview(ctx, a, it.ID, logs[n.ID], review.Again, now); err != nil {
			t.Fatal(err)
		}
	}
	itemOf := func(id string) int {
		return countRows(t, s, `SELECT count(*) FROM "ReviewItem" WHERE "ownerId" = $1 AND "kind" = 'entry' AND "targetId" = $2`, a, id)
	}
	logOf := func(id string) int {
		return countRows(t, s, `SELECT count(*) FROM "ReviewLog" WHERE "id" = $1`, logs[id])
	}
	for _, n := range notes[:3] {
		if err := s.TrashEntry(ctx, a, n.ID, now); err != nil {
			t.Fatal(err)
		}
	}

	if err := s.PurgeEntry(ctx, a, notes[0].ID); err != nil {
		t.Fatal(err)
	}
	if itemOf(notes[0].ID) != 0 || logOf(notes[0].ID) != 0 {
		t.Errorf("purged note's item or log left")
	}
	if itemOf(notes[1].ID) != 1 || itemOf(notes[3].ID) != 1 {
		t.Errorf("purge took another note's item")
	}
	if err := s.PurgeEntry(ctx, a, notes[0].ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second purge: %v", err)
	}

	if n, err := s.EmptyTrash(ctx, a); err != nil || n != 2 {
		t.Fatalf("empty trash = %d, %v", n, err)
	}
	for _, n := range notes[1:3] {
		if itemOf(n.ID) != 0 || logOf(n.ID) != 0 {
			t.Errorf("emptied note %s's item or log left", n.ID)
		}
	}
	if itemOf(notes[3].ID) != 1 || logOf(notes[3].ID) != 1 {
		t.Errorf("empty trash took the item of a note out of the trash")
	}
	if n, err := s.EmptyTrash(ctx, a); err != nil || n != 0 {
		t.Errorf("empty trash again = %d, %v", n, err)
	}
}

func TestAnEntryItemWithoutItsNoteIsListedBare(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	gone := newID()
	if _, err := s.EnqueueReviewItems(ctx, a, []ReviewTarget{target(ReviewKindEntry, gone)}, now); err != nil {
		t.Fatal(err)
	}
	it := dueEntryItem(t, s, a, gone, now)
	if it == nil || it.Entry != nil {
		t.Fatalf("item of a missing note = %+v", it)
	}
	if n, _ := s.CountDueReviewItems(ctx, a, now); n != 1 {
		t.Errorf("count = %d", n)
	}
}

func TestEntryIDsInReviewLeavesOutTheTrash(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := reviewOwner(t, s), reviewOwner(t, s)
	now := fixedNow()
	notes := createEntries(t, s, a, now.Add(-time.Hour), 3, 0)
	if ids, err := s.EntryIDsInReview(ctx, a); err != nil || len(ids) != 0 {
		t.Fatalf("none = %v, %v", ids, err)
	}
	for _, n := range notes[:2] {
		if err := s.AddEntryReview(ctx, a, n.ID, now); err != nil {
			t.Fatal(err)
		}
	}
	ids, err := s.EntryIDsInReview(ctx, a)
	if err != nil || len(ids) != 2 {
		t.Fatalf("ids = %v, %v", ids, err)
	}
	for _, id := range ids {
		if id != notes[0].ID && id != notes[1].ID {
			t.Errorf("unexpected id %s in %v", id, ids)
		}
	}
	if other, err := s.EntryIDsInReview(ctx, b); err != nil || len(other) != 0 {
		t.Errorf("another owner = %v, %v", other, err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE "LearningEntry" SET "deletedAt" = $2 WHERE "id" = $1`, notes[0].ID, dbTime(now)); err != nil {
		t.Fatal(err)
	}
	if ids, err := s.EntryIDsInReview(ctx, a); err != nil || len(ids) != 1 || ids[0] != notes[1].ID {
		t.Errorf("after trashing one = %v, %v", ids, err)
	}
}
