package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// ReviewTarget names something an owner can review: the language studied
// ("zh"), what kind of thing it is ("preposition", "complement",
// "vocabulary", "entry") and its id in that kind's data.
type ReviewTarget struct {
	Language string
	Kind     string
	TargetID string
}

// EnqueueReviewItems puts the targets in the owner's queue, due at now: the
// ones the owner does not have yet as new cards, and the ones already queued
// for later brought forward to now (missed again, they should come back
// soon), keeping their FSRS memory state. It returns how many were added or
// brought forward.
func (s *Store) EnqueueReviewItems(ctx context.Context, ownerID string, targets []ReviewTarget, now time.Time) (int, error) {
	now = dbTime(now)
	added := 0
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, t := range targets {
			tag, err := tx.Exec(ctx, `INSERT INTO "ReviewItem"
 ("id", "ownerId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $6)
 ON CONFLICT ("ownerId", "language", "kind", "targetId") DO UPDATE
 SET "due" = EXCLUDED."due", "updatedAt" = EXCLUDED."updatedAt"
 WHERE "ReviewItem"."due" > EXCLUDED."due"`,
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
