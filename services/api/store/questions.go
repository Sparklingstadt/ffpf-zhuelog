package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type QuestionSummary struct {
	ID        string
	Question  string
	ModelName string
	CreatedAt time.Time
}

type Question struct {
	QuestionSummary
	Answer string
}

const questionColumns = `"id", "question", "modelName", "createdAt"`

func (q *QuestionSummary) dest() []any { return []any{&q.ID, &q.Question, &q.ModelName, &q.CreatedAt} }

func (s *Store) ListQuestions(ctx context.Context, ownerID string, limit int) ([]QuestionSummary, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+questionColumns+` FROM "QuickQuestion" WHERE "ownerId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT $2`, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list questions: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (QuestionSummary, error) {
		var q QuestionSummary
		err := row.Scan(q.dest()...)
		return q, err
	})
	if err != nil {
		return nil, fmt.Errorf("store: list questions: %w", err)
	}
	if out == nil {
		out = []QuestionSummary{}
	}
	return out, nil
}

func (s *Store) GetQuestion(ctx context.Context, ownerID, id string) (Question, error) {
	return scanQuestion(s.pool.QueryRow(ctx, `SELECT `+questionColumns+`, "answer" FROM "QuickQuestion" WHERE "id" = $1 AND "ownerId" = $2`, id, ownerID))
}

// Retrying the identical save returns the original record. A finished Q&A
// cannot be continued or overwritten, even by its owner.
func (s *Store) PutQuestion(ctx context.Context, ownerID string, q Question, now time.Time) (Question, error) {
	return scanQuestion(s.pool.QueryRow(ctx, `INSERT INTO "QuickQuestion"
 ("id", "ownerId", "question", "answer", "modelName", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)
 ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id"
 WHERE "QuickQuestion"."ownerId" = EXCLUDED."ownerId"
 AND "QuickQuestion"."question" = EXCLUDED."question" AND "QuickQuestion"."answer" = EXCLUDED."answer"
 RETURNING `+questionColumns+`, "answer"`, q.ID, ownerID, q.Question, q.Answer, q.ModelName, dbTime(now)))
}

func scanQuestion(row pgx.Row) (Question, error) {
	var q Question
	if err := row.Scan(append(q.dest(), &q.Answer)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Question{}, ErrNotFound
		}
		return Question{}, fmt.Errorf("store: question: %w", err)
	}
	return q, nil
}
