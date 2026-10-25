package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// PrepositionQuestion is one question of a finished preposition round: the
// answer, the noun and the phrase with the blank, and the wrong prepositions
// picked before the answer, in the order they were picked.
type PrepositionQuestion struct {
	Answer string   `json:"answer"`
	Noun   string   `json:"noun"`
	Prompt string   `json:"prompt"`
	Misses []string `json:"misses"`
}

// PrepositionRecordSummary is a saved round without its questions.
// FirstTryCount is the questions answered without a miss; MissCount is every
// wrong pick.
type PrepositionRecordSummary struct {
	ID            string
	QuestionCount int
	FirstTryCount int
	MissCount     int
	ElapsedMs     int
	StartedAt     time.Time
	CreatedAt     time.Time
}

// PrepositionRecord is a member's or admin's finished round of preposition
// practice.
type PrepositionRecord struct {
	PrepositionRecordSummary
	Questions []PrepositionQuestion
}

const prepositionRecordSummaryColumns = `"id", "questionCount", "firstTryCount", "missCount", "elapsedMs", "startedAt", "createdAt"`

func (r *PrepositionRecordSummary) dest() []any {
	return []any{&r.ID, &r.QuestionCount, &r.FirstTryCount, &r.MissCount, &r.ElapsedMs, &r.StartedAt, &r.CreatedAt}
}

// ListPrepositionRecords returns up to limit of the owner's rounds, newest
// first by (createdAt, id).
func (s *Store) ListPrepositionRecords(ctx context.Context, ownerID string, limit int) ([]PrepositionRecordSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+prepositionRecordSummaryColumns+` FROM "PrepositionPracticeRecord"
		 WHERE "ownerId" = $1
		 ORDER BY "createdAt" DESC, "id" DESC
		 LIMIT $2`, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list preposition records: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (PrepositionRecordSummary, error) {
		var r PrepositionRecordSummary
		err := row.Scan(r.dest()...)
		return r, err
	})
	if err != nil {
		return nil, fmt.Errorf("store: list preposition records: %w", err)
	}
	if out == nil {
		out = []PrepositionRecordSummary{}
	}
	return out, nil
}

// GetPrepositionRecord returns one of the owner's rounds, or ErrNotFound when
// it does not exist or belongs to someone else.
func (s *Store) GetPrepositionRecord(ctx context.Context, ownerID, id string) (PrepositionRecord, error) {
	r, err := scanPrepositionRecord(s.pool.QueryRow(ctx,
		`SELECT `+prepositionRecordSummaryColumns+`, "questions" FROM "PrepositionPracticeRecord"
		 WHERE "id" = $1 AND "ownerId" = $2`, id, ownerID))
	if err != nil {
		return PrepositionRecord{}, fmt.Errorf("store: get preposition record: %w", err)
	}
	return r, nil
}

// AddPrepositionRecord saves a finished round for the owner with createdAt
// now. The counts come from r.Questions; r's own counts are ignored. Saving an
// id the owner already has changes nothing and returns the saved round, so a
// retried save keeps one row. When the id belongs to another owner nothing
// changes and ErrNotFound is returned.
func (s *Store) AddPrepositionRecord(ctx context.Context, ownerID string, r PrepositionRecord, now time.Time) (PrepositionRecord, error) {
	firstTry, misses := 0, 0
	// A copy, so the caller's questions keep their nil misses.
	qs := make([]PrepositionQuestion, len(r.Questions))
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
		return PrepositionRecord{}, fmt.Errorf("store: add preposition record: %w", err)
	}
	// The no-op update makes RETURNING give back the row already saved.
	out, err := scanPrepositionRecord(s.pool.QueryRow(ctx,
		`INSERT INTO "PrepositionPracticeRecord"
		   ("id", "ownerId", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions", "startedAt", "createdAt")
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
		 ON CONFLICT ("id") DO UPDATE SET "id" = "PrepositionPracticeRecord"."id"
		 WHERE "PrepositionPracticeRecord"."ownerId" = EXCLUDED."ownerId"
		 RETURNING `+prepositionRecordSummaryColumns+`, "questions"`,
		r.ID, ownerID, len(qs), firstTry, misses, r.ElapsedMs, string(questions),
		dbTime(r.StartedAt), dbTime(now)))
	if err != nil {
		return PrepositionRecord{}, fmt.Errorf("store: add preposition record: %w", err)
	}
	return out, nil
}

// scanPrepositionRecord reads a summary followed by the questions column; no
// row is ErrNotFound.
func scanPrepositionRecord(row pgx.Row) (PrepositionRecord, error) {
	var r PrepositionRecord
	var questions []byte
	if err := row.Scan(append(r.dest(), &questions)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PrepositionRecord{}, ErrNotFound
		}
		return PrepositionRecord{}, err
	}
	if err := json.Unmarshal(questions, &r.Questions); err != nil {
		return PrepositionRecord{}, err
	}
	return r, nil
}
