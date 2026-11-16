package store

import (
	"context"
	"fmt"
	"time"
)

// AIUsage is one OpenAI call: whom it was for, the feature (an aiusage
// Feature), the model and the tokens it used.
type AIUsage struct {
	OwnerID      string
	Feature      string
	Model        string
	InputTokens  int
	OutputTokens int
}

// RecordAIUsage stores one call at now. LINE records its calls with it; the
// web writes and reads the other rows.
func (s *Store) RecordAIUsage(ctx context.Context, u AIUsage, now time.Time) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO "AiUsage" ("id", "ownerId", "feature", "model", "inputTokens", "outputTokens", "createdAt")
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		newID(), u.OwnerID, u.Feature, u.Model, u.InputTokens, u.OutputTokens, dbTime(now))
	if err != nil {
		return fmt.Errorf("store: record ai usage: %w", err)
	}
	return nil
}
