package store

import (
	"context"
	"testing"
	"time"
)

// newOwner returns a fresh owner ID and removes its refresh tokens when the
// test ends.
func newOwner(t *testing.T, s *Store) string {
	t.Helper()
	owner := "password:" + newID()
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "ApiRefreshToken" WHERE "ownerId" = $1`, owner)
	})
	return owner
}

func fixedNow() time.Time {
	return time.Date(2026, 10, 20, 12, 34, 56, 789_000_000, time.UTC)
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
