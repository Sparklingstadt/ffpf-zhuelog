package store

import (
	"context"
	"time"
)

// pruneThrottleBatch bounds how many dead throttle rows one attempt deletes.
const pruneThrottleBatch = 100

// ConsumeThrottle counts one attempt against key in a fixed window and reports
// whether the attempt is within limit. The first attempt, or the first after
// the window ended, starts a new window of the given length at now.
//
// The statements mirror the web app's PrismaSignInThrottle (same table, same
// key formats), so the web and the API share one count per key.
func (s *Store) ConsumeThrottle(ctx context.Context, key string, limit int, window time.Duration, now time.Time) (bool, error) {
	now = dbTime(now)
	expires := now.Add(window)

	// SKIP LOCKED: concurrent sign-ins never wait on, or deadlock over, each
	// other's cleanup.
	if _, err := s.pool.Exec(ctx, `
DELETE FROM "SignInThrottle" WHERE "key" IN (
  SELECT "key" FROM "SignInThrottle"
  WHERE "expiresAt" <= CAST($1 AS TIMESTAMP(3))
  LIMIT $2 FOR UPDATE SKIP LOCKED
)`, now, pruneThrottleBatch); err != nil {
		return false, err
	}

	// One statement, so concurrent attempts cannot read the same count.
	var count int
	err := s.pool.QueryRow(ctx, `
INSERT INTO "SignInThrottle" ("key", "count", "expiresAt")
VALUES ($1, 1, CAST($3 AS TIMESTAMP(3)))
ON CONFLICT ("key") DO UPDATE SET
  "count" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST($2 AS TIMESTAMP(3)) THEN 1 ELSE "SignInThrottle"."count" + 1 END,
  "expiresAt" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST($2 AS TIMESTAMP(3)) THEN CAST($3 AS TIMESTAMP(3)) ELSE "SignInThrottle"."expiresAt" END
RETURNING "count"`, key, now, expires).Scan(&count)
	if err != nil {
		return false, err
	}
	return count <= limit, nil
}

// ResetThrottle forgets key's attempts (after a successful sign-in).
func (s *Store) ResetThrottle(ctx context.Context, key string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM "SignInThrottle" WHERE "key" = $1`, key)
	return err
}
