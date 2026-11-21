// The demo reset seeds rounds with these; the web reads and saves them.

package store

import (
	"strconv"
	"strings"
	"time"
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

// practiceKind is one kind of practice whose finished rounds are kept: its
// table and whether its rounds have a mode.
type practiceKind struct {
	table   string
	hasMode bool
}

var (
	prepositionPractice = practiceKind{table: `"PrepositionPracticeRecord"`}
	complementPractice  = practiceKind{table: `"ComplementPracticeRecord"`, hasMode: true}
)

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
