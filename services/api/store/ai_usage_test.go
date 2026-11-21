package store

import (
	"context"
	"testing"
	"time"
)

// aiUsageOwner is a new owner whose usage rows are removed after the test.
func aiUsageOwner(t *testing.T, owner string) {
	t.Helper()
	t.Cleanup(func() {
		s := testStore(t)
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "AiUsage" WHERE "ownerId" = $1`, owner)
	})
}

func TestRecordAIUsageStoresOneCall(t *testing.T) {
	s := testStore(t)
	owner := newOwner(t, s)
	aiUsageOwner(t, owner)
	at := time.Date(2026, 10, 31, 15, 0, 0, 0, time.UTC)

	u := AIUsage{OwnerID: owner, Feature: "line", Model: "gpt-5-mini", InputTokens: 100, OutputTokens: 50}
	if err := s.RecordAIUsage(context.Background(), u, at); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM "AiUsage" WHERE "ownerId" = $1 AND "feature" = 'line'
	 AND "model" = 'gpt-5-mini' AND "inputTokens" = 100 AND "outputTokens" = 50 AND "createdAt" = $2`, owner, at); n != 1 {
		t.Fatalf("%d matching rows; want 1", n)
	}
}
