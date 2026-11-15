package store

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// ReviewItem names its target by kind and targetId, with no foreign key, so
// every path that deletes a note or a word for good must delete its item too.
// These tests run each such path and look for items (and logs) left behind.

// orphanReviews counts the owner's "entry" items whose note is gone, their
// "vocabulary" items whose word is gone, and review logs whose item is gone.
func orphanReviews(t *testing.T, s *Store, owner string) (entries, words, logs int) {
	t.Helper()
	entries = countRows(t, s, `SELECT count(*) FROM "ReviewItem" i
 WHERE i."ownerId" = $1 AND i."kind" = $2 AND NOT EXISTS
  (SELECT 1 FROM "LearningEntry" e WHERE e."id" = i."targetId" AND e."ownerId" = i."ownerId")`, owner, ReviewKindEntry)
	words = countRows(t, s, `SELECT count(*) FROM "ReviewItem" i
 WHERE i."ownerId" = $1 AND i."kind" = $2 AND NOT EXISTS
  (SELECT 1 FROM "VocabularyEntry" v WHERE v."id" = i."targetId" AND v."ownerId" = i."ownerId")`, owner, ReviewKindVocabulary)
	logs = countRows(t, s, `SELECT count(*) FROM "ReviewLog" l
 WHERE l."ownerId" = $1 AND NOT EXISTS (SELECT 1 FROM "ReviewItem" i WHERE i."id" = l."itemId")`, owner)
	return entries, words, logs
}

func assertNoOrphanReviews(t *testing.T, s *Store, owner string) {
	t.Helper()
	if e, w, l := orphanReviews(t, s, owner); e+w+l != 0 {
		t.Errorf("orphans: %d entry items, %d vocabulary items, %d logs; want none", e, w, l)
	}
}

// answerItem answers the item once, so it has a review log.
func answerItem(t *testing.T, s *Store, owner, kind, targetID string, now time.Time) {
	t.Helper()
	ctx := context.Background()
	due, err := s.ListDueReviewItems(ctx, owner, now.Add(24*time.Hour), 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range due {
		if it.Kind == kind && it.TargetID == targetID {
			if _, err := s.RecordReview(ctx, owner, it.ID, newUUID(), review.Good, now); err != nil {
				t.Fatal(err)
			}
			return
		}
	}
	t.Fatalf("no due %s item for %s", kind, targetID)
}

// notesInReview stores n notes, puts each in review and answers it once.
func notesInReview(t *testing.T, s *Store, owner string, now time.Time, n int) []Entry {
	t.Helper()
	notes := createEntries(t, s, owner, now.Add(-time.Hour), n, 1)
	for _, e := range notes {
		if err := s.AddEntryReview(context.Background(), owner, e.ID, now); err != nil {
			t.Fatal(err)
		}
		answerItem(t, s, owner, ReviewKindEntry, e.ID, now)
	}
	return notes
}

func reviewCount(t *testing.T, s *Store, owner string) (items, logs int) {
	t.Helper()
	return countRows(t, s, `SELECT count(*) FROM "ReviewItem" WHERE "ownerId" = $1`, owner),
		countRows(t, s, `SELECT count(*) FROM "ReviewLog" WHERE "ownerId" = $1`, owner)
}

func TestPurgeEntryLeavesNoOrphanReview(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	notes := notesInReview(t, s, a, now, 2)
	if err := s.TrashEntry(ctx, a, notes[0].ID, now); err != nil {
		t.Fatal(err)
	}
	if err := s.PurgeEntry(ctx, a, notes[0].ID); err != nil {
		t.Fatal(err)
	}
	assertNoOrphanReviews(t, s, a)
	if items, logs := reviewCount(t, s, a); items != 1 || logs != 1 {
		t.Errorf("%d items and %d logs left, want the other note's 1 and 1", items, logs)
	}
}

func TestEmptyTrashLeavesNoOrphanReview(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	notes := notesInReview(t, s, a, now, 3)
	for _, e := range notes[:2] {
		if err := s.TrashEntry(ctx, a, e.ID, now); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := s.EmptyTrash(ctx, a); err != nil || n != 2 {
		t.Fatalf("empty trash = %d, %v", n, err)
	}
	assertNoOrphanReviews(t, s, a)
	if items, logs := reviewCount(t, s, a); items != 1 || logs != 1 {
		t.Errorf("%d items and %d logs left, want the kept note's 1 and 1", items, logs)
	}
}

func TestRemoveEntryReviewLeavesNoOrphanLog(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	notes := notesInReview(t, s, a, now, 1)
	if err := s.RemoveEntryReview(ctx, a, notes[0].ID); err != nil {
		t.Fatal(err)
	}
	assertNoOrphanReviews(t, s, a)
	if items, logs := reviewCount(t, s, a); items != 0 || logs != 0 {
		t.Errorf("%d items and %d logs left, want none", items, logs)
	}
}

func TestDeleteVocabularyLeavesNoOrphanReview(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := vocabularyOwner(t, s)
	now := fixedNow()
	gone, kept := word("认真", "まじめに"), word("吃饭", "ご飯を食べる")
	for _, w := range []VocabularyEntry{gone, kept} {
		if _, err := s.PutVocabulary(ctx, a, w, now); err != nil {
			t.Fatal(err)
		}
		answerItem(t, s, a, ReviewKindVocabulary, w.ID, now)
	}
	if err := s.DeleteVocabulary(ctx, a, gone.ID); err != nil {
		t.Fatal(err)
	}
	assertNoOrphanReviews(t, s, a)
	if items, logs := reviewCount(t, s, a); items != 1 || logs != 1 {
		t.Errorf("%d items and %d logs left, want the kept word's 1 and 1", items, logs)
	}
}

// The reset replaces everything the demo owns, including what visitors put
// in review during the day; nothing of theirs may survive as an orphan.
func TestResetDemoLeavesNoOrphanReview(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	loginID := newDemoLoginID(t, s)
	now := fixedNow()
	id, err := s.ResetDemo(ctx, loginID, smallDemoSeed(now), now)
	if err != nil {
		t.Fatal(err)
	}
	owner := MemberOwnerID(id)
	notesInReview(t, s, owner, now, 2)
	w := word("认真", "まじめに")
	if _, err := s.PutVocabulary(ctx, owner, w, now); err != nil {
		t.Fatal(err)
	}
	answerItem(t, s, owner, ReviewKindVocabulary, w.ID, now)

	if _, err := s.ResetDemo(ctx, loginID, smallDemoSeed(now), now); err != nil {
		t.Fatal(err)
	}
	assertNoOrphanReviews(t, s, owner)
	// Only the seed's note and word are in review, with the note's one answer.
	if items, logs := reviewCount(t, s, owner); items != 2 || logs != 1 {
		t.Errorf("%d items and %d logs after the reset, want the seed's 2 and 1", items, logs)
	}
}

// demoKeptTables are owner-scoped tables the demo reset leaves alone on
// purpose.
var demoKeptTables = map[string]string{
	// The demo's sessions survive the nightly reset.
	"ApiRefreshToken": "sessions are kept",
	// The admin's record of OpenAI spend; the demo cannot call OpenAI.
	"AiUsage": "the admin's usage ledger",
}

// Every table with an "ownerId" column must be deleted by the demo reset (or
// be listed in demoKeptTables with a reason), so a new owner-scoped table
// cannot leave the visitors' rows behind unnoticed.
func TestDemoResetCoversEveryOwnerTable(t *testing.T) {
	s := testStore(t)
	rows, err := s.pool.Query(context.Background(), `SELECT table_name FROM information_schema.columns
 WHERE table_schema = current_schema() AND column_name = 'ownerId' ORDER BY table_name`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(tables) == 0 {
		t.Fatal("no table has an ownerId column; is the schema migrated?")
	}
	// A table no Prisma model describes is not part of the schema (a local
	// database can keep one from another branch's migration); it is reported
	// and skipped.
	models := prismaModels(t)
	// deleteDemoData deletes these two itself, outside demoOwnedTables.
	deleted := append([]string{"LearningEntry", "ReviewLog"}, demoOwnedTables...)
	for _, table := range tables {
		if !slices.Contains(models, table) {
			t.Logf("table %q has an ownerId column but is not in prisma/schema.prisma; skipped", table)
			continue
		}
		if _, kept := demoKeptTables[table]; kept || slices.Contains(deleted, table) {
			continue
		}
		t.Errorf("table %q has an ownerId column but the demo reset does not delete its rows: "+
			"add it to demoOwnedTables in store/demo.go (or, if the reset must keep it, to demoKeptTables here with the reason)", table)
	}
	for _, table := range append(deleted, keysOf(demoKeptTables)...) {
		if !slices.Contains(tables, table) {
			t.Errorf("table %q is listed for the demo reset but has no ownerId column", table)
		}
	}
}

// prismaModels returns the model names of prisma/schema.prisma, which are the
// table names (the schema uses no @@map).
func prismaModels(t *testing.T) []string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "prisma", "schema.prisma"))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, m := range regexp.MustCompile(`(?m)^model (\w+) \{`).FindAllSubmatch(data, -1) {
		out = append(out, string(m[1]))
	}
	if len(out) == 0 {
		t.Fatal("no models in prisma/schema.prisma")
	}
	return out
}

func keysOf(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
