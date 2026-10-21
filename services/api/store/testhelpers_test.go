package store

import (
	"context"
	"strconv"
	"testing"
	"time"
)

// newOwner returns a fresh owner ID and removes everything it created when the
// test ends: entries and hints (ImportBatch deletion cascades) and refresh tokens.
func newOwner(t *testing.T, s *Store) string {
	t.Helper()
	owner := "password:" + newID()
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(),
			`DELETE FROM "ImportBatch" WHERE id IN (SELECT "batchId" FROM "LearningEntry" WHERE "ownerId" = $1)`, owner)
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "ApiRefreshToken" WHERE "ownerId" = $1`, owner)
	})
	return owner
}

func draft(n string, hints ...string) EntryDraft {
	return EntryDraft{
		Kind:          "correction",
		OriginalText:  "orig " + n,
		CorrectedText: "corr " + n,
		Pinyin:        "pin " + n,
		Hints:         hints,
	}
}

// createTied stores drafts as one batch and then gives every entry the same
// createdAt (CreateBatch spaces them 1 ms apart), for (createdAt, id) tie tests.
func createTied(t *testing.T, s *Store, owner string, drafts []EntryDraft, at time.Time) []Entry {
	t.Helper()
	ctx := context.Background()
	_, created, err := s.CreateBatch(ctx, owner, drafts, at)
	if err != nil {
		t.Fatal(err)
	}
	at = dbTime(at)
	ids := make([]string, len(created))
	for i := range created {
		ids[i] = created[i].ID
		created[i].CreatedAt = at
	}
	if _, err := s.pool.Exec(ctx, `UPDATE "LearningEntry" SET "createdAt" = $1 WHERE "id" = ANY($2)`, at, ids); err != nil {
		t.Fatal(err)
	}
	return created
}

func fixedNow() time.Time {
	return time.Date(2026, 10, 20, 12, 34, 56, 789_000_000, time.UTC)
}

// createEntries stores n entries as one batch, all with createdAt at and
// hintCount hints each (hint contents "h0", "h1", ...).
func createEntries(t *testing.T, s *Store, owner string, at time.Time, n, hintCount int) []Entry {
	t.Helper()
	hints := make([]string, hintCount)
	for i := range hints {
		hints[i] = "h" + strconv.Itoa(i)
	}
	drafts := make([]EntryDraft, n)
	for i := range drafts {
		drafts[i] = draft(string(rune('a'+i)), hints...)
	}
	return createTied(t, s, owner, drafts, at)
}

// countRows runs a "SELECT count(*) ..." query and returns the count.
func countRows(t *testing.T, s *Store, query string, args ...any) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
