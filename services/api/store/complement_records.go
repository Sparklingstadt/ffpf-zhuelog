package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ComplementQuestion is one question of a finished complement round: the
// answer, the noun and the phrase with the blank, and the wrong complements
// picked before the answer, in the order they were picked.
type ComplementQuestion struct {
	Answer string   `json:"answer"`
	Noun   string   `json:"noun"`
	Prompt string   `json:"prompt"`
	Misses []string `json:"misses"`
}

// ComplementRecordSummary is a saved round without its questions.
// FirstTryCount is the questions answered without a miss; MissCount is every
// wrong pick.
type ComplementRecordSummary struct {
	ID            string
	Mode          string
	QuestionCount int
	FirstTryCount int
	MissCount     int
	ElapsedMs     int
	StartedAt     time.Time
	CreatedAt     time.Time
}

// ComplementRecord is a member's or admin's finished round of complement
// practice.
type ComplementRecord struct {
	ComplementRecordSummary
	Questions []ComplementQuestion
}

const complementRecordSummaryColumns = `"id", "mode", "questionCount", "firstTryCount", "missCount", "elapsedMs", "startedAt", "createdAt"`

func (r *ComplementRecordSummary) dest() []any {
	return []any{&r.ID, &r.Mode, &r.QuestionCount, &r.FirstTryCount, &r.MissCount, &r.ElapsedMs, &r.StartedAt, &r.CreatedAt}
}

// ListComplementRecords returns up to limit of the owner's rounds, newest
// first by (createdAt, id).
func (s *Store) ListComplementRecords(ctx context.Context, ownerID string, limit int) ([]ComplementRecordSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+complementRecordSummaryColumns+` FROM "ComplementPracticeRecord"
		 WHERE "ownerId" = $1
		 ORDER BY "createdAt" DESC, "id" DESC
		 LIMIT $2`, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list complement records: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ComplementRecordSummary, error) {
		var r ComplementRecordSummary
		err := row.Scan(r.dest()...)
		return r, err
	})
	if err != nil {
		return nil, fmt.Errorf("store: list complement records: %w", err)
	}
	if out == nil {
		out = []ComplementRecordSummary{}
	}
	return out, nil
}

// GetComplementRecord returns one of the owner's rounds, or ErrNotFound when
// it does not exist or belongs to someone else.
func (s *Store) GetComplementRecord(ctx context.Context, ownerID, id string) (ComplementRecord, error) {
	r, err := scanComplementRecord(s.pool.QueryRow(ctx,
		`SELECT `+complementRecordSummaryColumns+`, "questions" FROM "ComplementPracticeRecord"
		 WHERE "id" = $1 AND "ownerId" = $2`, id, ownerID))
	if err != nil {
		return ComplementRecord{}, fmt.Errorf("store: get complement record: %w", err)
	}
	return r, nil
}

// AddComplementRecord saves a finished round for the owner with createdAt
// now. The counts come from r.Questions; r's own counts are ignored. Saving an
// id the owner already has changes nothing and returns the saved round, so a
// retried save keeps one row. When the id belongs to another owner nothing
// changes and ErrNotFound is returned.
func (s *Store) AddComplementRecord(ctx context.Context, ownerID string, r ComplementRecord, now time.Time) (ComplementRecord, error) {
	firstTry, misses := 0, 0
	// A copy, so the caller's questions keep their nil misses.
	qs := make([]ComplementQuestion, len(r.Questions))
	for i, q := range r.Questions {
		if q.Misses == nil {
			q.Misses = []string{}
		}
		if len(q.Misses) == 0 {
			firstTry++
		}
		misses += len(q.Misses)
		qs[i] = q
	}
	questions, err := json.Marshal(qs)
	if err != nil {
		return ComplementRecord{}, fmt.Errorf("store: add complement record: %w", err)
	}
	// The no-op update makes RETURNING give back the row already saved.
	out, err := scanComplementRecord(s.pool.QueryRow(ctx,
		`INSERT INTO "ComplementPracticeRecord"
		   ("id", "ownerId", "mode", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions", "startedAt", "createdAt")
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
		 ON CONFLICT ("id") DO UPDATE SET "id" = "ComplementPracticeRecord"."id"
		 WHERE "ComplementPracticeRecord"."ownerId" = EXCLUDED."ownerId"
		 RETURNING `+complementRecordSummaryColumns+`, "questions"`,
		r.ID, ownerID, r.Mode, len(qs), firstTry, misses, r.ElapsedMs, string(questions),
		dbTime(r.StartedAt), dbTime(now)))
	if err != nil {
		return ComplementRecord{}, fmt.Errorf("store: add complement record: %w", err)
	}
	return out, nil
}

// scanComplementRecord reads a summary followed by the questions column; no
// row is ErrNotFound.
func scanComplementRecord(row pgx.Row) (ComplementRecord, error) {
	var r ComplementRecord
	var questions []byte
	if err := row.Scan(append(r.dest(), &questions)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ComplementRecord{}, ErrNotFound
		}
		return ComplementRecord{}, err
	}
	if err := json.Unmarshal(questions, &r.Questions); err != nil {
		return ComplementRecord{}, err
	}
	return r, nil
}
