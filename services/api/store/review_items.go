package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// ReviewTarget names something an owner can review: the language studied
// ("zh"), what kind of thing it is ("preposition", "complement") and its id
// in that kind's data.
type ReviewTarget struct {
	Language string
	Kind     string
	TargetID string
}

// ReviewItem is one of an owner's targets with its FSRS card.
type ReviewItem struct {
	ID string
	ReviewTarget
	review.Card
	CreatedAt time.Time
	UpdatedAt time.Time
}

const reviewItemColumns = `"id", "language", "kind", "targetId", "due", "stability", "difficulty",
 "scheduledDays", "reps", "lapses", "state", "remainingSteps", "lastReview", "createdAt", "updatedAt"`

func scanReviewItem(row pgx.Row) (ReviewItem, error) {
	var it ReviewItem
	var state int
	var lastReview *time.Time
	err := row.Scan(&it.ID, &it.Language, &it.Kind, &it.TargetID, &it.Due, &it.Stability, &it.Difficulty,
		&it.ScheduledDays, &it.Reps, &it.Lapses, &state, &it.RemainingSteps, &lastReview, &it.CreatedAt, &it.UpdatedAt)
	if err != nil {
		return ReviewItem{}, err
	}
	it.State = review.State(state)
	if lastReview != nil {
		it.LastReview = *lastReview
	}
	return it, nil
}

// EnqueueReviewItems adds the targets the owner does not have yet as new
// cards due at now. Targets already queued keep their schedule. It returns
// how many were added.
func (s *Store) EnqueueReviewItems(ctx context.Context, ownerID string, targets []ReviewTarget, now time.Time) (int, error) {
	now = dbTime(now)
	added := 0
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, t := range targets {
			tag, err := tx.Exec(ctx, `INSERT INTO "ReviewItem"
 ("id", "ownerId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $6)
 ON CONFLICT ("ownerId", "language", "kind", "targetId") DO NOTHING`,
				newID(), ownerID, t.Language, t.Kind, t.TargetID, now, int(review.New))
			if err != nil {
				return err
			}
			added += int(tag.RowsAffected())
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("store: enqueue review items: %w", err)
	}
	return added, nil
}

// ListDueReviewItems returns up to limit of the owner's items due at or
// before now, the longest overdue first.
func (s *Store) ListDueReviewItems(ctx context.Context, ownerID string, now time.Time, limit int) ([]ReviewItem, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+reviewItemColumns+` FROM "ReviewItem"
 WHERE "ownerId" = $1 AND "due" <= $2 ORDER BY "due", "id" LIMIT $3`, ownerID, dbTime(now), limit)
	if err != nil {
		return nil, fmt.Errorf("store: list due review items: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ReviewItem, error) { return scanReviewItem(row) })
	if err != nil {
		return nil, fmt.Errorf("store: list due review items: %w", err)
	}
	if out == nil {
		out = []ReviewItem{}
	}
	return out, nil
}

// CountDueReviewItems is how many of the owner's items are due at or before now.
func (s *Store) CountDueReviewItems(ctx context.Context, ownerID string, now time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM "ReviewItem" WHERE "ownerId" = $1 AND "due" <= $2`,
		ownerID, dbTime(now)).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("store: count due review items: %w", err)
	}
	return n, nil
}

// RecordReview applies an answer rated rating at now to the owner's item and
// logs it under logID, in one transaction. A retry with the same logID
// returns the item as it stands without answering again. Another owner's
// item, an unknown item, or a logID already used for a different item
// returns ErrNotFound.
func (s *Store) RecordReview(ctx context.Context, ownerID, itemID, logID string, rating review.Rating, now time.Time) (ReviewItem, error) {
	now = dbTime(now)
	var out ReviewItem
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// The row lock makes concurrent answers to one item, retries included,
		// take turns.
		it, err := scanReviewItem(tx.QueryRow(ctx, `SELECT `+reviewItemColumns+` FROM "ReviewItem"
 WHERE "id" = $1 AND "ownerId" = $2 FOR UPDATE`, itemID, ownerID))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}

		var loggedItem, loggedOwner string
		err = tx.QueryRow(ctx, `SELECT "itemId", "ownerId" FROM "ReviewLog" WHERE "id" = $1`, logID).
			Scan(&loggedItem, &loggedOwner)
		if err == nil {
			if loggedItem != itemID || loggedOwner != ownerID {
				return ErrNotFound
			}
			out = it
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		next, err := review.Next(it.Card, rating, now)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO "ReviewLog"
 ("id", "ownerId", "itemId", "rating", "state", "due", "stability", "difficulty", "scheduledDays", "reviewedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			logID, ownerID, itemID, int(rating), int(it.State), dbTime(it.Due), it.Stability, it.Difficulty,
			it.ScheduledDays, now); err != nil {
			return err
		}
		out, err = scanReviewItem(tx.QueryRow(ctx, `UPDATE "ReviewItem" SET
 "due" = $3, "stability" = $4, "difficulty" = $5, "scheduledDays" = $6, "reps" = $7, "lapses" = $8,
 "state" = $9, "remainingSteps" = $10, "lastReview" = $11, "updatedAt" = $12
 WHERE "id" = $1 AND "ownerId" = $2 RETURNING `+reviewItemColumns,
			itemID, ownerID, dbTime(next.Due), next.Stability, next.Difficulty, next.ScheduledDays, next.Reps,
			next.Lapses, int(next.State), next.RemainingSteps, dbTime(next.LastReview), now))
		return err
	})
	if errors.Is(err, ErrNotFound) {
		return ReviewItem{}, ErrNotFound
	}
	if err != nil {
		return ReviewItem{}, fmt.Errorf("store: record review: %w", err)
	}
	return out, nil
}
