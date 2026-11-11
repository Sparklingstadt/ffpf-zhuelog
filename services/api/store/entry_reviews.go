package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// ReviewKindEntry is the ReviewItem kind of a learning note the owner put in
// review; its targetId is the note's id. A note in the trash keeps its card,
// but the item is left out of the due list and count until the note is
// restored. Deleting the note for good deletes the item.
const ReviewKindEntry = "entry"

// entryReviewLanguage is the language of a note's review item: notes are
// Chinese.
const entryReviewLanguage = "zh"

// notTrashedEntry is a ReviewItem condition that leaves out the items of
// notes in the trash. kindParam is the placeholder ("$3") bound to
// ReviewKindEntry.
func notTrashedEntry(kindParam string) string {
	return `NOT EXISTS (SELECT 1 FROM "LearningEntry" e
 WHERE "ReviewItem"."kind" = ` + kindParam + ` AND e."id" = "ReviewItem"."targetId"
   AND e."ownerId" = "ReviewItem"."ownerId" AND e."deletedAt" IS NOT NULL)`
}

// EntryInReview reports whether the owner's note is in their review queue.
// A note that is not theirs, does not exist or is in the trash returns
// ErrNotFound.
func (s *Store) EntryInReview(ctx context.Context, ownerID, entryID string) (bool, error) {
	var in bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM "ReviewItem" r
 WHERE r."ownerId" = e."ownerId" AND r."kind" = $3 AND r."targetId" = e."id")
 FROM "LearningEntry" e WHERE e."id" = $1 AND e."ownerId" = $2 AND e."deletedAt" IS NULL`,
		entryID, ownerID, ReviewKindEntry).Scan(&in)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, fmt.Errorf("store: entry in review: %w", err)
	}
	return in, nil
}

// EntryIDsInReview are the ids of the owner's notes in their review queue,
// leaving out notes in the trash.
func (s *Store) EntryIDsInReview(ctx context.Context, ownerID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT r."targetId" FROM "ReviewItem" r
 JOIN "LearningEntry" e ON e."id" = r."targetId" AND e."ownerId" = r."ownerId" AND e."deletedAt" IS NULL
 WHERE r."ownerId" = $1 AND r."kind" = $2 ORDER BY r."targetId"`, ownerID, ReviewKindEntry)
	if err != nil {
		return nil, fmt.Errorf("store: entry ids in review: %w", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("store: entry ids in review: %w", err)
	}
	if out == nil {
		out = []string{}
	}
	return out, nil
}

// AddEntryReview puts the owner's note in their review queue as a new card,
// due at now. A note already there keeps its card as it is. A note that is
// not theirs, does not exist or is in the trash returns ErrNotFound.
func (s *Store) AddEntryReview(ctx context.Context, ownerID, entryID string, now time.Time) error {
	now = dbTime(now)
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockOwnEntry(ctx, tx, ownerID, entryID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO "ReviewItem"
 ("id", "ownerId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $6)
 ON CONFLICT ("ownerId", "language", "kind", "targetId") DO NOTHING`,
			newID(), ownerID, entryReviewLanguage, ReviewKindEntry, entryID, now, int(review.New))
		return err
	})
	if errors.Is(err, ErrNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("store: add entry review: %w", err)
	}
	return nil
}

// RemoveEntryReview takes the owner's note out of their review queue, with
// its card's log. A note that was not in review succeeds too. A note that is
// not theirs, does not exist or is in the trash returns ErrNotFound.
func (s *Store) RemoveEntryReview(ctx context.Context, ownerID, entryID string) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockOwnEntry(ctx, tx, ownerID, entryID); err != nil {
			return err
		}
		return deleteEntryReviews(ctx, tx, ownerID, []string{entryID})
	})
	if errors.Is(err, ErrNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("store: remove entry review: %w", err)
	}
	return nil
}

// lockOwnEntry locks the owner's note that is not in the trash until tx
// ends, or returns ErrNotFound. The note cannot be trashed meanwhile, so it
// cannot be deleted for good before tx commits and leave an item behind.
// Other errors are returned unwrapped.
func lockOwnEntry(ctx context.Context, tx pgx.Tx, ownerID, id string) error {
	var one int
	err := tx.QueryRow(ctx, `SELECT 1 FROM "LearningEntry"
 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NULL FOR SHARE`, id, ownerID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// deleteEntryReviews deletes the owner's review items of the notes ids (their
// logs cascade). Errors are returned unwrapped.
func deleteEntryReviews(ctx context.Context, q dbtx, ownerID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, `DELETE FROM "ReviewItem" WHERE "ownerId" = $1 AND "kind" = $2 AND "targetId" = ANY($3)`,
		ownerID, ReviewKindEntry, ids)
	return err
}

// entriesByID returns the owner's notes with the given ids that are not in
// the trash, with their hints, by id. Errors are returned unwrapped.
func entriesByID(ctx context.Context, q dbtx, ownerID string, ids []string) (map[string]Entry, error) {
	out := map[string]Entry{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT `+entryColumns+` FROM "LearningEntry"
 WHERE "ownerId" = $1 AND "id" = ANY($2) AND "deletedAt" IS NULL`, ownerID, ids)
	if err != nil {
		return nil, err
	}
	entries, err := scanEntries(rows)
	if err != nil {
		return nil, err
	}
	if err := attachHints(ctx, q, entryPtrs(entries)); err != nil {
		return nil, err
	}
	for _, e := range entries {
		out[e.ID] = e
	}
	return out, nil
}
