package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// PracticeQuestion is one question of a finished preposition or complement
// round: the answer, the noun and the phrase with the blank, and the wrong
// choices picked before the answer, in the order they were picked. ID names
// the question in the Web's practice data; rounds saved before it was kept
// have none.
type PracticeQuestion struct {
	ID     string   `json:"id,omitempty"`
	Answer string   `json:"answer"`
	Noun   string   `json:"noun"`
	Prompt string   `json:"prompt"`
	Misses []string `json:"misses"`
}

// PracticeRecordSummary is a saved round without its questions.
// FirstTryCount is the questions answered without a miss; MissCount is every
// wrong pick. Mode is the complement practice's mode; preposition rounds have
// none, so it stays "" for them.
type PracticeRecordSummary struct {
	ID            string
	Mode          string
	QuestionCount int
	FirstTryCount int
	MissCount     int
	ElapsedMs     int
	StartedAt     time.Time
	CreatedAt     time.Time
}

type (
	// PrepositionQuestion is a question of a preposition round.
	PrepositionQuestion = PracticeQuestion
	// ComplementQuestion is a question of a complement round.
	ComplementQuestion = PracticeQuestion
	// PrepositionRecordSummary is a preposition round without its questions
	// (Mode is always "").
	PrepositionRecordSummary = PracticeRecordSummary
	// ComplementRecordSummary is a complement round without its questions.
	ComplementRecordSummary = PracticeRecordSummary
)

// PrepositionRecord is a member's or admin's finished round of preposition
// practice.
type PrepositionRecord struct {
	PrepositionRecordSummary
	Questions []PrepositionQuestion
}

// ComplementRecord is a member's or admin's finished round of complement
// practice.
type ComplementRecord struct {
	ComplementRecordSummary
	Questions []ComplementQuestion
}

// practiceKind is one kind of practice whose finished rounds are kept: the
// name used in error messages, its table, and whether its rounds have a mode.
type practiceKind struct {
	name    string
	table   string
	hasMode bool
}

var (
	prepositionPractice = practiceKind{name: "preposition", table: `"PrepositionPracticeRecord"`}
	complementPractice  = practiceKind{name: "complement", table: `"ComplementPracticeRecord"`, hasMode: true}
)

// summaryColumns are the columns read into a PracticeRecordSummary, in dest's
// order.
func (k practiceKind) summaryColumns() string {
	mode := ""
	if k.hasMode {
		mode = `"mode", `
	}
	return `"id", ` + mode + `"questionCount", "firstTryCount", "missCount", "elapsedMs", "startedAt", "createdAt"`
}

func (k practiceKind) dest(r *PracticeRecordSummary) []any {
	d := []any{&r.ID}
	if k.hasMode {
		d = append(d, &r.Mode)
	}
	return append(d, &r.QuestionCount, &r.FirstTryCount, &r.MissCount, &r.ElapsedMs, &r.StartedAt, &r.CreatedAt)
}

// insert is the INSERT of one round of k's (without a conflict clause) and
// its arguments. The counts are r's; questions is the JSON of the questions.
func (k practiceKind) insert(ownerID string, r PracticeRecordSummary, questions string, createdAt time.Time) (string, []any) {
	cols := []string{`"id"`, `"ownerId"`}
	args := []any{r.ID, ownerID}
	if k.hasMode {
		cols = append(cols, `"mode"`)
		args = append(args, r.Mode)
	}
	cols = append(cols, `"questionCount"`, `"firstTryCount"`, `"missCount"`, `"elapsedMs"`, `"questions"`, `"startedAt"`, `"createdAt"`)
	args = append(args, r.QuestionCount, r.FirstTryCount, r.MissCount, r.ElapsedMs, questions, dbTime(r.StartedAt), dbTime(createdAt))
	values := make([]string, len(cols))
	for i, c := range cols {
		values[i] = "$" + strconv.Itoa(i+1)
		if c == `"questions"` {
			values[i] += "::jsonb"
		}
	}
	return `INSERT INTO ` + k.table + ` (` + strings.Join(cols, ", ") + `) VALUES (` + strings.Join(values, ", ") + `)`, args
}

// ListPrepositionRecords returns up to limit of the owner's rounds, newest
// first by (createdAt, id).
func (s *Store) ListPrepositionRecords(ctx context.Context, ownerID string, limit int) ([]PrepositionRecordSummary, error) {
	return s.listPracticeRecords(ctx, prepositionPractice, ownerID, limit)
}

// ListComplementRecords returns up to limit of the owner's rounds, newest
// first by (createdAt, id).
func (s *Store) ListComplementRecords(ctx context.Context, ownerID string, limit int) ([]ComplementRecordSummary, error) {
	return s.listPracticeRecords(ctx, complementPractice, ownerID, limit)
}

// GetPrepositionRecord returns one of the owner's rounds, or ErrNotFound when
// it does not exist or belongs to someone else.
func (s *Store) GetPrepositionRecord(ctx context.Context, ownerID, id string) (PrepositionRecord, error) {
	sum, qs, err := s.getPracticeRecord(ctx, prepositionPractice, ownerID, id)
	if err != nil {
		return PrepositionRecord{}, err
	}
	return PrepositionRecord{sum, qs}, nil
}

// GetComplementRecord returns one of the owner's rounds, or ErrNotFound when
// it does not exist or belongs to someone else.
func (s *Store) GetComplementRecord(ctx context.Context, ownerID, id string) (ComplementRecord, error) {
	sum, qs, err := s.getPracticeRecord(ctx, complementPractice, ownerID, id)
	if err != nil {
		return ComplementRecord{}, err
	}
	return ComplementRecord{sum, qs}, nil
}

// AddPrepositionRecord saves a finished round for the owner with createdAt
// now. The counts come from r.Questions; r's own counts are ignored. Saving an
// id the owner already has changes nothing and returns the saved round, so a
// retried save keeps one row. When the id belongs to another owner nothing
// changes and ErrNotFound is returned.
func (s *Store) AddPrepositionRecord(ctx context.Context, ownerID string, r PrepositionRecord, now time.Time) (PrepositionRecord, error) {
	sum, qs, err := s.addPracticeRecord(ctx, prepositionPractice, ownerID, r.PrepositionRecordSummary, r.Questions, now)
	if err != nil {
		return PrepositionRecord{}, err
	}
	return PrepositionRecord{sum, qs}, nil
}

// AddComplementRecord is AddPrepositionRecord for complement rounds; a retry
// keeps the mode first saved, too.
func (s *Store) AddComplementRecord(ctx context.Context, ownerID string, r ComplementRecord, now time.Time) (ComplementRecord, error) {
	sum, qs, err := s.addPracticeRecord(ctx, complementPractice, ownerID, r.ComplementRecordSummary, r.Questions, now)
	if err != nil {
		return ComplementRecord{}, err
	}
	return ComplementRecord{sum, qs}, nil
}

func (s *Store) listPracticeRecords(ctx context.Context, k practiceKind, ownerID string, limit int) ([]PracticeRecordSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+k.summaryColumns()+` FROM `+k.table+`
		 WHERE "ownerId" = $1
		 ORDER BY "createdAt" DESC, "id" DESC
		 LIMIT $2`, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list %s records: %w", k.name, err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (PracticeRecordSummary, error) {
		var r PracticeRecordSummary
		err := row.Scan(k.dest(&r)...)
		return r, err
	})
	if err != nil {
		return nil, fmt.Errorf("store: list %s records: %w", k.name, err)
	}
	if out == nil {
		out = []PracticeRecordSummary{}
	}
	return out, nil
}

func (s *Store) getPracticeRecord(ctx context.Context, k practiceKind, ownerID, id string) (PracticeRecordSummary, []PracticeQuestion, error) {
	sum, qs, err := k.scan(s.pool.QueryRow(ctx,
		`SELECT `+k.summaryColumns()+`, "questions" FROM `+k.table+`
		 WHERE "id" = $1 AND "ownerId" = $2`, id, ownerID))
	if err != nil {
		return PracticeRecordSummary{}, nil, fmt.Errorf("store: get %s record: %w", k.name, err)
	}
	return sum, qs, nil
}

func (s *Store) addPracticeRecord(ctx context.Context, k practiceKind, ownerID string, r PracticeRecordSummary, questions []PracticeQuestion, now time.Time) (PracticeRecordSummary, []PracticeQuestion, error) {
	firstTry, misses := 0, 0
	// A copy, so the caller's questions keep their nil misses.
	qs := make([]PracticeQuestion, len(questions))
	for i, q := range questions {
		if q.Misses == nil {
			q.Misses = []string{}
		}
		if len(q.Misses) == 0 {
			firstTry++
		}
		misses += len(q.Misses)
		qs[i] = q
	}
	body, err := json.Marshal(qs)
	if err != nil {
		return PracticeRecordSummary{}, nil, fmt.Errorf("store: add %s record: %w", k.name, err)
	}
	r.QuestionCount, r.FirstTryCount, r.MissCount = len(qs), firstTry, misses
	insert, args := k.insert(ownerID, r, string(body), now)
	// The no-op update makes RETURNING give back the row already saved.
	sum, saved, err := k.scan(s.pool.QueryRow(ctx, insert+`
		 ON CONFLICT ("id") DO UPDATE SET "id" = `+k.table+`."id"
		 WHERE `+k.table+`."ownerId" = EXCLUDED."ownerId"
		 RETURNING `+k.summaryColumns()+`, "questions"`, args...))
	if err != nil {
		return PracticeRecordSummary{}, nil, fmt.Errorf("store: add %s record: %w", k.name, err)
	}
	return sum, saved, nil
}

// scan reads a summary followed by the questions column; no row is
// ErrNotFound.
func (k practiceKind) scan(row pgx.Row) (PracticeRecordSummary, []PracticeQuestion, error) {
	var r PracticeRecordSummary
	var questions []byte
	if err := row.Scan(append(k.dest(&r), &questions)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PracticeRecordSummary{}, nil, ErrNotFound
		}
		return PracticeRecordSummary{}, nil, err
	}
	var qs []PracticeQuestion
	if err := json.Unmarshal(questions, &qs); err != nil {
		return PracticeRecordSummary{}, nil, err
	}
	return r, qs, nil
}
