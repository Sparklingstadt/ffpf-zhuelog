package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// PracticeKind tells the kinds of practice apart in PracticeRecord.
type PracticeKind string

const (
	PracticeKindPreposition PracticeKind = "preposition"
	PracticeKindComplement  PracticeKind = "complement"
)

// PracticeQuestion is one question of a finished round: the answer, the
// headword (a noun, a verb) and the phrase with the blank, and the wrong
// words picked before the answer, in the order they were picked.
type PracticeQuestion struct {
	Answer   string   `json:"answer"`
	Headword string   `json:"headword"`
	Prompt   string   `json:"prompt"`
	Misses   []string `json:"misses"`
}

// PracticeRecordSummary is a saved round without its questions.
// FirstTryCount is the questions answered without a miss; MissCount is every
// wrong pick.
type PracticeRecordSummary struct {
	ID            string
	QuestionCount int
	FirstTryCount int
	MissCount     int
	ElapsedMs     int
	StartedAt     time.Time
	CreatedAt     time.Time
}

// PracticeRecord is a member's or admin's finished round of practice of one
// kind.
type PracticeRecord struct {
	PracticeRecordSummary
	Questions []PracticeQuestion
}

const practiceRecordSummaryColumns = `"id", "questionCount", "firstTryCount", "missCount", "elapsedMs", "startedAt", "createdAt"`

func (r *PracticeRecordSummary) dest() []any {
	return []any{&r.ID, &r.QuestionCount, &r.FirstTryCount, &r.MissCount, &r.ElapsedMs, &r.StartedAt, &r.CreatedAt}
}

// ListPracticeRecords returns up to limit of the owner's rounds of the kind,
// newest first by (createdAt, id).
func (s *Store) ListPracticeRecords(ctx context.Context, kind PracticeKind, ownerID string, limit int) ([]PracticeRecordSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+practiceRecordSummaryColumns+` FROM "PracticeRecord"
		 WHERE "ownerId" = $1 AND "kind" = $2
		 ORDER BY "createdAt" DESC, "id" DESC
		 LIMIT $3`, ownerID, string(kind), limit)
	if err != nil {
		return nil, fmt.Errorf("store: list practice records: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (PracticeRecordSummary, error) {
		var r PracticeRecordSummary
		err := row.Scan(r.dest()...)
		return r, err
	})
	if err != nil {
		return nil, fmt.Errorf("store: list practice records: %w", err)
	}
	if out == nil {
		out = []PracticeRecordSummary{}
	}
	return out, nil
}

// GetPracticeRecord returns one of the owner's rounds of the kind, or
// ErrNotFound when it does not exist, belongs to someone else or is of
// another kind.
func (s *Store) GetPracticeRecord(ctx context.Context, kind PracticeKind, ownerID, id string) (PracticeRecord, error) {
	r, err := scanPracticeRecord(s.pool.QueryRow(ctx,
		`SELECT `+practiceRecordSummaryColumns+`, "questions" FROM "PracticeRecord"
		 WHERE "id" = $1 AND "ownerId" = $2 AND "kind" = $3`, id, ownerID, string(kind)))
	if err != nil {
		return PracticeRecord{}, fmt.Errorf("store: get practice record: %w", err)
	}
	return r, nil
}

// AddPracticeRecord saves a finished round of the kind for the owner with
// createdAt now. The counts come from r.Questions; r's own counts are
// ignored. Saving an id the owner already has changes nothing and returns
// the saved round, so a retried save keeps one row. When the id belongs to
// another owner or another kind nothing changes and ErrNotFound is returned.
func (s *Store) AddPracticeRecord(ctx context.Context, kind PracticeKind, ownerID string, r PracticeRecord, now time.Time) (PracticeRecord, error) {
	firstTry, misses := 0, 0
	// A copy, so the caller's questions keep their nil misses.
	qs := make([]PracticeQuestion, len(r.Questions))
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
		return PracticeRecord{}, fmt.Errorf("store: add practice record: %w", err)
	}
	// The no-op update makes RETURNING give back the row already saved.
	out, err := scanPracticeRecord(s.pool.QueryRow(ctx,
		`INSERT INTO "PracticeRecord"
		   ("id", "ownerId", "kind", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions", "startedAt", "createdAt")
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
		 ON CONFLICT ("id") DO UPDATE SET "id" = "PracticeRecord"."id"
		 WHERE "PracticeRecord"."ownerId" = EXCLUDED."ownerId" AND "PracticeRecord"."kind" = EXCLUDED."kind"
		 RETURNING `+practiceRecordSummaryColumns+`, "questions"`,
		r.ID, ownerID, string(kind), len(qs), firstTry, misses, r.ElapsedMs, string(questions),
		dbTime(r.StartedAt), dbTime(now)))
	if err != nil {
		return PracticeRecord{}, fmt.Errorf("store: add practice record: %w", err)
	}
	return out, nil
}

// scanPracticeRecord reads a summary followed by the questions column; no
// row is ErrNotFound.
func scanPracticeRecord(row pgx.Row) (PracticeRecord, error) {
	var r PracticeRecord
	var questions []byte
	if err := row.Scan(append(r.dest(), &questions)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PracticeRecord{}, ErrNotFound
		}
		return PracticeRecord{}, err
	}
	if err := json.Unmarshal(questions, &r.Questions); err != nil {
		return PracticeRecord{}, err
	}
	return r, nil
}
