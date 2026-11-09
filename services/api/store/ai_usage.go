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

// AIUsageTotal adds up one owner's calls of one feature and model. DisplayName
// is the member's name, or "" for an admin (who has no account row).
type AIUsageTotal struct {
	OwnerID      string
	DisplayName  string
	Feature      string
	Model        string
	Requests     int
	InputTokens  int64
	OutputTokens int64
}

// RecordAIUsage stores one call at now.
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

// AIUsageMonth returns the totals of the calls made in the JST month
// (year, month), by owner, feature and model. Owners with the most tokens
// come first.
func (s *Store) AIUsageMonth(ctx context.Context, year, month int) ([]AIUsageTotal, error) {
	from := dbTime(time.Date(year, time.Month(month), 1, 0, 0, 0, 0, jst))
	to := dbTime(time.Date(year, time.Month(month)+1, 1, 0, 0, 0, 0, jst))
	rows, err := s.pool.Query(ctx,
		`SELECT u."ownerId", coalesce(m."displayName", ''), u."feature", u."model",
		        count(*), sum(u."inputTokens"), sum(u."outputTokens"),
		        sum(sum(u."inputTokens" + u."outputTokens")) OVER (PARTITION BY u."ownerId") AS "ownerTokens"
		 FROM "AiUsage" u
		 LEFT JOIN `+memberAccounts("$3", "$4")+` m ON m."ownerId" = u."ownerId"
		 WHERE u."createdAt" >= $1 AND u."createdAt" < $2
		 GROUP BY u."ownerId", m."displayName", u."feature", u."model"
		 ORDER BY "ownerTokens" DESC, u."ownerId", u."feature", u."model"`,
		from, to, MemberOwnerPrefix, FfpfOwnerPrefix)
	if err != nil {
		return nil, fmt.Errorf("store: ai usage month: %w", err)
	}
	defer rows.Close()
	out := []AIUsageTotal{}
	for rows.Next() {
		var t AIUsageTotal
		var requests, ownerTokens int64
		if err := rows.Scan(&t.OwnerID, &t.DisplayName, &t.Feature, &t.Model,
			&requests, &t.InputTokens, &t.OutputTokens, &ownerTokens); err != nil {
			return nil, fmt.Errorf("store: ai usage month: %w", err)
		}
		t.Requests = int(requests)
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: ai usage month: %w", err)
	}
	return out, nil
}
