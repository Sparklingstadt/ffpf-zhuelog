package store

import (
	"context"
	"fmt"
	"time"
)

// ReviewNotifyTarget is a LINE account whose owner asked for the morning
// message and has reviews due.
type ReviewNotifyTarget struct {
	LineUserID string
	OwnerID    string
	Role       string
	Due        int
}

// LineReviewNotify reports whether the owner has a LINE account linked and,
// if so, whether they asked for the review message.
func (s *Store) LineReviewNotify(ctx context.Context, ownerID string) (linked, on bool, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM "LineLink" WHERE "ownerId" = $1),
		        COALESCE((SELECT "reviewNotify" FROM "LineLink" WHERE "ownerId" = $1), false)`, ownerID).
		Scan(&linked, &on)
	if err != nil {
		return false, false, fmt.Errorf("store: line review notify: %w", err)
	}
	return linked, on, nil
}

// SetLineReviewNotify turns the owner's review message on or off. An owner
// without a linked LINE account returns ErrNotFound.
func (s *Store) SetLineReviewNotify(ctx context.Context, ownerID string, on bool) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE "LineLink" SET "reviewNotify" = $2 WHERE "ownerId" = $1`, ownerID, on)
	if err != nil {
		return fmt.Errorf("store: set line review notify: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// jstDate is the JST calendar date of t, as midnight UTC (how pgx reads and
// writes a DATE).
func jstDate(t time.Time) time.Time {
	j := t.In(jst)
	return time.Date(j.Year(), j.Month(), j.Day(), 0, 0, 0, 0, time.UTC)
}

// ListReviewNotifyTargets returns, oldest link first and at most limit of
// them, the LINE accounts that asked for the review message, have not had one
// on now's JST date, and whose owner has reviews due at now (notes in the
// trash left out, as in the review queue).
func (s *Store) ListReviewNotifyTargets(ctx context.Context, now time.Time, limit int) ([]ReviewNotifyTarget, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT l."lineUserId", l."ownerId", l."role", d."due"
		 FROM "LineLink" l
		 CROSS JOIN LATERAL (
		   SELECT count(*) AS "due" FROM "ReviewItem"
		   WHERE "ReviewItem"."ownerId" = l."ownerId" AND "ReviewItem"."due" <= $1 AND `+notTrashedEntry("$4")+`
		 ) d
		 WHERE l."reviewNotify" AND (l."reviewNotifiedOn" IS NULL OR l."reviewNotifiedOn" < $2) AND d."due" > 0
		 ORDER BY l."createdAt", l."lineUserId"
		 LIMIT $3`, dbTime(now), jstDate(now), limit, ReviewKindEntry)
	if err != nil {
		return nil, fmt.Errorf("store: list review notify targets: %w", err)
	}
	defer rows.Close()
	out := []ReviewNotifyTarget{}
	for rows.Next() {
		var t ReviewNotifyTarget
		var due int64
		if err := rows.Scan(&t.LineUserID, &t.OwnerID, &t.Role, &due); err != nil {
			return nil, fmt.Errorf("store: list review notify targets: %w", err)
		}
		t.Due = int(due)
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list review notify targets: %w", err)
	}
	return out, nil
}

// ClaimReviewNotify records that the LINE account gets now's JST date's
// message. It reports false when that date was already claimed (another run
// sent it) or the account asked to stop meanwhile, so at most one message is
// sent a day.
func (s *Store) ClaimReviewNotify(ctx context.Context, lineUserID string, now time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE "LineLink" SET "reviewNotifiedOn" = $2
		 WHERE "lineUserId" = $1 AND "reviewNotify"
		   AND ("reviewNotifiedOn" IS NULL OR "reviewNotifiedOn" < $2)`, lineUserID, jstDate(now))
	if err != nil {
		return false, fmt.Errorf("store: claim review notify: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
