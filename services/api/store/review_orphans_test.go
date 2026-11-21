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
// These tests run each such path the Go API still has and look for items (and
// logs) left behind; the web's purge and empty trash are tested there.

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

// answerTarget answers the owner's item of kind and targetID once, so it has
// a review log.
func answerTarget(t *testing.T, s *Store, owner, kind, targetID string, now time.Time) {
	t.Helper()
	for _, it := range dueItems(t, s, owner, now.Add(24*time.Hour)) {
		if it.Kind == kind && it.TargetID == targetID {
			answerItem(t, s, owner, it.ID, review.Good, now)
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
		putEntryInReview(t, s, owner, e.ID, now)
		answerTarget(t, s, owner, ReviewKindEntry, e.ID, now)
	}
	return notes
}

func reviewCount(t *testing.T, s *Store, owner string) (items, logs int) {
	t.Helper()
	return countRows(t, s, `SELECT count(*) FROM "ReviewItem" WHERE "ownerId" = $1`, owner),
		countRows(t, s, `SELECT count(*) FROM "ReviewLog" WHERE "ownerId" = $1`, owner)
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
	addWord(t, s, owner, w, now)
	answerTarget(t, s, owner, ReviewKindVocabulary, w.ID, now)

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
