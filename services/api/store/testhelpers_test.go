package store

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
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

// createBatch stores drafts as one import batch named "test", created from at,
// in one transaction (entry i at at + i ms; see queueImportBatch).
func createBatch(t *testing.T, s *Store, owner string, drafts []EntryDraft, at time.Time) []Entry {
	t.Helper()
	ctx := context.Background()
	var created []Entry
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		b := &pgx.Batch{}
		_, created = queueImportBatch(b, owner, "test", drafts, at)
		return execBatch(ctx, tx, b)
	})
	if err != nil {
		t.Fatal(err)
	}
	return created
}

// createTied stores drafts as one batch and then gives every entry the same
// createdAt (createBatch spaces them 1 ms apart), for (createdAt, id)
// tie tests.
func createTied(t *testing.T, s *Store, owner string, drafts []EntryDraft, at time.Time) []Entry {
	t.Helper()
	ctx := context.Background()
	created := createBatch(t, s, owner, drafts, at)
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

// The web writes the notes (trash, restore, share) since stage 2 of the Go
// retirement; these helpers make the same changes for the Go code that still
// reads the notes (timeline, reviews, LINE, demo reset).

// trashNote moves one of the owner's notes to the trash at at.
func trashNote(t *testing.T, s *Store, owner, id string, at time.Time) {
	t.Helper()
	execOne(t, s, `UPDATE "LearningEntry" SET "deletedAt" = $3
	 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NULL`, id, owner, dbTime(at))
}

// restoreNote takes one of the owner's notes out of the trash.
func restoreNote(t *testing.T, s *Store, owner, id string) {
	t.Helper()
	execOne(t, s, `UPDATE "LearningEntry" SET "deletedAt" = NULL
	 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NOT NULL`, id, owner)
}

// shareNote shares one of the owner's notes outside the trash at at.
func shareNote(t *testing.T, s *Store, owner, id string, at time.Time) {
	t.Helper()
	execOne(t, s, `UPDATE "LearningEntry" SET "sharedAt" = $3
	 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NULL`, id, owner, dbTime(at))
}

// execOne runs an UPDATE that must change exactly one row.
func execOne(t *testing.T, s *Store, query string, args ...any) {
	t.Helper()
	tag, err := s.pool.Exec(context.Background(), query, args...)
	if err != nil {
		t.Fatal(err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("%d rows changed, want 1", tag.RowsAffected())
	}
}

// liveNotes returns the owner's notes outside the trash with their hints,
// newest first, read with the scan the timeline and reviews use.
func liveNotes(t *testing.T, s *Store, owner string) []Entry {
	t.Helper()
	return readNotes(t, s, `SELECT `+entryColumns+` FROM "LearningEntry"
	 WHERE "ownerId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC, "id" DESC`, owner)
}

// liveNote returns one of the owner's notes outside the trash, or false.
func liveNote(t *testing.T, s *Store, owner, id string) (Entry, bool) {
	t.Helper()
	es := readNotes(t, s, `SELECT `+entryColumns+` FROM "LearningEntry"
	 WHERE "id" = $2 AND "ownerId" = $1 AND "deletedAt" IS NULL`, owner, id)
	if len(es) == 0 {
		return Entry{}, false
	}
	return es[0], true
}

func readNotes(t *testing.T, s *Store, query string, args ...any) []Entry {
	t.Helper()
	ctx := context.Background()
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		t.Fatal(err)
	}
	es, err := scanEntries(rows)
	if err != nil {
		t.Fatal(err)
	}
	if err := attachHints(ctx, s.pool, entryPtrs(es)); err != nil {
		t.Fatal(err)
	}
	return es
}

// The web reads and answers the review queue since stage 4 of the Go
// retirement; these helpers do the same for the Go code that still writes or
// counts it (practice, demo reset, study log, LINE).

// dueReview is one of an owner's review items that is due.
type dueReview struct {
	ID, Kind, TargetID string
}

// dueItems returns the owner's items due at or before now, leaving out the
// items of notes in the trash, the longest overdue first.
func dueItems(t *testing.T, s *Store, owner string, now time.Time) []dueReview {
	t.Helper()
	rows, err := s.pool.Query(context.Background(), `SELECT "id", "kind", "targetId" FROM "ReviewItem"
	 WHERE "ownerId" = $1 AND "due" <= $2 AND `+notTrashedEntry("$3")+` ORDER BY "due", "id"`,
		owner, dbTime(now), ReviewKindEntry)
	if err != nil {
		t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[dueReview])
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// reviewCard returns the FSRS card of one of the owner's items.
func reviewCard(t *testing.T, s *Store, owner, itemID string) review.Card {
	t.Helper()
	var c review.Card
	var state int
	var lastReview *time.Time
	err := s.pool.QueryRow(context.Background(), `SELECT "due", "stability", "difficulty", "scheduledDays",
	 "reps", "lapses", "state", "remainingSteps", "lastReview" FROM "ReviewItem" WHERE "id" = $1 AND "ownerId" = $2`,
		itemID, owner).Scan(&c.Due, &c.Stability, &c.Difficulty, &c.ScheduledDays, &c.Reps, &c.Lapses, &state,
		&c.RemainingSteps, &lastReview)
	if err != nil {
		t.Fatal(err)
	}
	c.State = review.State(state)
	if lastReview != nil {
		c.LastReview = *lastReview
	}
	return c
}

// answerItem answers one of the owner's items rated rating at now, as the
// web does: it logs the card as it was and reschedules the item with FSRS.
func answerItem(t *testing.T, s *Store, owner, itemID string, rating review.Rating, now time.Time) {
	t.Helper()
	ctx := context.Background()
	now = dbTime(now)
	c := reviewCard(t, s, owner, itemID)
	next, err := review.Next(c, rating, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO "ReviewLog"
	 ("id", "ownerId", "itemId", "rating", "state", "due", "stability", "difficulty", "scheduledDays", "reviewedAt")
	 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		newUUID(), owner, itemID, int(rating), int(c.State), dbTime(c.Due), c.Stability, c.Difficulty,
		c.ScheduledDays, now); err != nil {
		t.Fatal(err)
	}
	execOne(t, s, `UPDATE "ReviewItem" SET "due" = $3, "stability" = $4, "difficulty" = $5,
	 "scheduledDays" = $6, "reps" = $7, "lapses" = $8, "state" = $9, "remainingSteps" = $10,
	 "lastReview" = $11, "updatedAt" = $12 WHERE "id" = $1 AND "ownerId" = $2`,
		itemID, owner, dbTime(next.Due), next.Stability, next.Difficulty, next.ScheduledDays, next.Reps,
		next.Lapses, int(next.State), next.RemainingSteps, dbTime(next.LastReview), now)
}

// putEntryInReview puts one of the owner's notes in review as a new card due
// at now, as the web does; a note already there keeps its card.
func putEntryInReview(t *testing.T, s *Store, owner, entryID string, now time.Time) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(), `INSERT INTO "ReviewItem"
	 ("id", "ownerId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
	 VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $6)
	 ON CONFLICT ("ownerId", "language", "kind", "targetId") DO NOTHING`,
		newID(), owner, entryReviewLanguage, ReviewKindEntry, entryID, dbTime(now), int(review.New)); err != nil {
		t.Fatal(err)
	}
}
