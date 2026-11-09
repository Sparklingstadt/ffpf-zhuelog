package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// DemoPasswordHash is the demo account's password hash. It is not a valid
// scrypt hash, so no password ever signs in to it; people enter the demo
// with POST /v1/auth/demo instead.
const DemoPasswordHash = "demo:no-password"

// DemoSeed is what the demo account is reset to every night. Its times are
// absolute: the caller (package demo) makes them relative to the reset.
type DemoSeed struct {
	DisplayName        string
	Notes              []DemoNote
	Words              []DemoWord
	Conversations      []Conversation
	PrepositionRecords []PrepositionRecord
	ComplementRecords  []ComplementRecord
}

// DemoNote is one learning note. A non-nil Review puts it in review.
type DemoNote struct {
	EntryDraft
	CreatedAt time.Time
	Review    *DemoReview
}

// DemoWord is one word of the vocabulary book. SourceNote is the index in
// DemoSeed.Notes of the note it was picked from, or -1.
type DemoWord struct {
	ID         string
	Word       string
	Pinyin     string
	Meaning    string
	SourceNote int
	CreatedAt  time.Time
	Review     DemoReview
}

// DemoReview is an item's FSRS card and the answers that led to it.
type DemoReview struct {
	Card    review.Card
	Answers []DemoAnswer
}

// DemoAnswer is one past answer: the rating, when it was given and the card
// as it stood just before, as ReviewLog keeps it.
type DemoAnswer struct {
	Rating review.Rating
	At     time.Time
	Before review.Card
}

// demoOwnedTables are the tables with an "ownerId" column whose rows the
// reset deletes. Learning notes and hints go with their import batches, and
// review logs with their items.
var demoOwnedTables = []string{
	"ReviewItem", "VocabularyEntry", "ChatConversation", "QuickQuestion",
	"PrepositionPracticeRecord", "ComplementPracticeRecord",
	"LineLink", "LineLinkCode", "LineMessage",
}

// ResetDemo puts the demo account back to seed in one transaction: it makes
// the account (loginID, with DemoPasswordHash) if it is missing, deletes
// everything its owner has (notes, reviews, words, conversations, quick
// questions, practice records, follows and LINE rows) and inserts seed. The
// account's sessions are kept. It returns the account's ID.
func (s *Store) ResetDemo(ctx context.Context, loginID string, seed DemoSeed, now time.Time) (string, error) {
	now = dbTime(now)
	var accountID string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// A concurrent reset waits on the row (or the unique key) here.
		if _, err := tx.Exec(ctx, `
INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "sessionVersion", "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, 0, $5, $5)
ON CONFLICT ("loginId") DO NOTHING`, newID(), loginID, seed.DisplayName, DemoPasswordHash, now); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT "id" FROM "PasswordAccount" WHERE "loginId" = $1 FOR UPDATE`, loginID).
			Scan(&accountID); err != nil {
			return err
		}
		owner := MemberOwnerID(accountID)
		if err := deleteDemoData(ctx, tx, owner); err != nil {
			return err
		}
		return insertDemoSeed(ctx, tx, owner, seed)
	})
	if err != nil {
		return "", fmt.Errorf("store: reset demo: %w", err)
	}
	return accountID, nil
}

func deleteDemoData(ctx context.Context, tx pgx.Tx, owner string) error {
	// Each batch belongs to one owner; deleting it deletes its notes and
	// their hints.
	if _, err := tx.Exec(ctx, `DELETE FROM "ImportBatch" WHERE "id" IN
 (SELECT "batchId" FROM "LearningEntry" WHERE "ownerId" = $1)`, owner); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "LearningEntry" WHERE "ownerId" = $1`, owner); err != nil {
		return err
	}
	// The table names are constants, never input.
	for _, table := range demoOwnedTables {
		if _, err := tx.Exec(ctx, `DELETE FROM "`+table+`" WHERE "ownerId" = $1`, owner); err != nil {
			return err
		}
	}
	// ReviewLog rows of other items cannot exist, but the owner's own go too.
	if _, err := tx.Exec(ctx, `DELETE FROM "ReviewLog" WHERE "ownerId" = $1`, owner); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM "Follow" WHERE "followerId" = $1 OR "followeeId" = $1`, owner)
	return err
}

func insertDemoSeed(ctx context.Context, tx pgx.Tx, owner string, seed DemoSeed) error {
	b := &pgx.Batch{}
	noteIDs := make([]string, len(seed.Notes))
	for i, n := range seed.Notes {
		_, entries := queueImportBatch(b, owner, "demo:"+dbTime(n.CreatedAt).Format(isoMillisLayout),
			[]EntryDraft{n.EntryDraft}, n.CreatedAt)
		noteIDs[i] = entries[0].ID
		if n.Review != nil {
			queueDemoReview(b, owner, ReviewKindEntry, noteIDs[i], n.CreatedAt, *n.Review)
		}
	}
	for _, w := range seed.Words {
		var source *string
		if w.SourceNote >= 0 && w.SourceNote < len(noteIDs) {
			source = &noteIDs[w.SourceNote]
		}
		b.Queue(`INSERT INTO "VocabularyEntry"
 ("id", "ownerId", "language", "word", "pinyin", "meaning", "sourceEntryId", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
			w.ID, owner, entryReviewLanguage, w.Word, w.Pinyin, w.Meaning, source, dbTime(w.CreatedAt))
		queueDemoReview(b, owner, ReviewKindVocabulary, w.ID, w.CreatedAt, w.Review)
	}
	for _, c := range seed.Conversations {
		messages, err := json.Marshal(c.Messages)
		if err != nil {
			return err
		}
		b.Queue(`INSERT INTO "ChatConversation"
 ("id", "ownerId", "title", "modelName", "ended", "messages", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
			c.ID, owner, c.Title, c.ModelName, c.Ended, string(messages), dbTime(c.CreatedAt), dbTime(c.UpdatedAt))
	}
	for _, r := range seed.PrepositionRecords {
		firstTry, misses := demoScore(len(r.Questions), func(i int) int { return len(r.Questions[i].Misses) })
		questions, err := json.Marshal(r.Questions)
		if err != nil {
			return err
		}
		b.Queue(`INSERT INTO "PrepositionPracticeRecord"
 ("id", "ownerId", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions", "startedAt", "createdAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
			r.ID, owner, len(r.Questions), firstTry, misses, r.ElapsedMs, string(questions),
			dbTime(r.StartedAt), dbTime(r.CreatedAt))
	}
	for _, r := range seed.ComplementRecords {
		firstTry, misses := demoScore(len(r.Questions), func(i int) int { return len(r.Questions[i].Misses) })
		questions, err := json.Marshal(r.Questions)
		if err != nil {
			return err
		}
		b.Queue(`INSERT INTO "ComplementPracticeRecord"
 ("id", "ownerId", "mode", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions", "startedAt", "createdAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
			r.ID, owner, r.Mode, len(r.Questions), firstTry, misses, r.ElapsedMs, string(questions),
			dbTime(r.StartedAt), dbTime(r.CreatedAt))
	}
	return execBatch(ctx, tx, b)
}

// demoScore counts the questions answered on the first try and every miss,
// as the practice routes do when they save a round.
func demoScore(n int, misses func(int) int) (firstTry, total int) {
	for i := range n {
		m := misses(i)
		if m == 0 {
			firstTry++
		}
		total += m
	}
	return firstTry, total
}

// queueDemoReview queues a review item with its card and a log row for each
// past answer.
func queueDemoReview(b *pgx.Batch, owner, kind, targetID string, created time.Time, r DemoReview) {
	itemID := newID()
	c := r.Card
	updated := created
	if !c.LastReview.IsZero() {
		updated = c.LastReview
	}
	b.Queue(`INSERT INTO "ReviewItem"
 ("id", "ownerId", "language", "kind", "targetId", "due", "stability", "difficulty", "scheduledDays",
  "reps", "lapses", "state", "remainingSteps", "lastReview", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		itemID, owner, entryReviewLanguage, kind, targetID, dbTime(c.Due), c.Stability, c.Difficulty, c.ScheduledDays,
		c.Reps, c.Lapses, int(c.State), c.RemainingSteps, demoNullableTime(c.LastReview), dbTime(created), dbTime(updated))
	for _, a := range r.Answers {
		p := a.Before
		b.Queue(`INSERT INTO "ReviewLog"
 ("id", "ownerId", "itemId", "rating", "state", "due", "stability", "difficulty", "scheduledDays", "reviewedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			newID(), owner, itemID, int(a.Rating), int(p.State), dbTime(p.Due), p.Stability, p.Difficulty,
			p.ScheduledDays, dbTime(a.At))
	}
}

func demoNullableTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	t = dbTime(t)
	return &t
}
