package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// PrepositionRecords is what the preposition practice handlers need from
// *store.Store.
type PrepositionRecords interface {
	ListPrepositionRecords(ctx context.Context, ownerID string, limit int) ([]store.PrepositionRecordSummary, error)
	GetPrepositionRecord(ctx context.Context, ownerID, id string) (store.PrepositionRecord, error)
	AddPrepositionRecord(ctx context.Context, ownerID string, r store.PrepositionRecord, now time.Time) (store.PrepositionRecord, error)
}

var _ PrepositionRecords = (*store.Store)(nil)

const (
	// prepositionRecordListLimit is how many rounds the list returns.
	prepositionRecordListLimit = 100

	maxPrepositionQuestions = 50
	// A question has four choices, so at most three wrong picks.
	maxPrepositionMisses  = 3
	maxPrepositionAnswer  = 10
	maxPrepositionNoun    = 40
	maxPrepositionPrompt  = 100
	maxPrepositionElapsed = 24 * time.Hour
)

type prepositionRecordSummaryJSON struct {
	ID            string `json:"id"`
	QuestionCount int    `json:"questionCount"`
	FirstTryCount int    `json:"firstTryCount"`
	MissCount     int    `json:"missCount"`
	ElapsedMs     int    `json:"elapsedMs"`
	StartedAt     string `json:"startedAt"`
	CreatedAt     string `json:"createdAt"`
}

type prepositionRecordJSON struct {
	prepositionRecordSummaryJSON
	Questions []store.PrepositionQuestion `json:"questions"`
}

func toPrepositionRecordSummaryJSON(r store.PrepositionRecordSummary) prepositionRecordSummaryJSON {
	return prepositionRecordSummaryJSON{
		ID: r.ID, QuestionCount: r.QuestionCount, FirstTryCount: r.FirstTryCount,
		MissCount: r.MissCount, ElapsedMs: r.ElapsedMs,
		StartedAt: formatTime(r.StartedAt), CreatedAt: formatTime(r.CreatedAt),
	}
}

func toPrepositionRecordJSON(r store.PrepositionRecord) prepositionRecordJSON {
	return prepositionRecordJSON{
		prepositionRecordSummaryJSON: toPrepositionRecordSummaryJSON(r.PrepositionRecordSummary),
		Questions:                    r.Questions,
	}
}

func listPrepositionRecords(rs PrepositionRecords) http.Handler {
	type response struct {
		Records []prepositionRecordSummaryJSON `json:"records"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		list, err := rs.ListPrepositionRecords(r.Context(), principalFrom(r.Context()).OwnerID, prepositionRecordListLimit)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{Records: make([]prepositionRecordSummaryJSON, len(list))}
		for i, rec := range list {
			out.Records[i] = toPrepositionRecordSummaryJSON(rec)
		}
		writeJSON(w, http.StatusOK, out)
	})
}

func getPrepositionRecord(rs PrepositionRecords) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgPrepositionRecordNotFound)
		if !ok {
			return
		}
		rec, err := rs.GetPrepositionRecord(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgPrepositionRecordNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toPrepositionRecordJSON(rec))
	})
}

// putPrepositionRecord saves the round the browser sends when its last
// question is answered. The id in the path names it, so a retry keeps one
// row; Go counts the misses and sets createdAt itself.
func putPrepositionRecord(rs PrepositionRecords, now func() time.Time) http.Handler {
	type request struct {
		StartedAt string                      `json:"startedAt"`
		ElapsedMs int                         `json:"elapsedMs"`
		Questions []store.PrepositionQuestion `json:"questions"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgPrepositionRecordNotFound)
		if !ok {
			return
		}
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		startedAt, err := time.Parse(time.RFC3339Nano, req.StartedAt)
		if err != nil || !validPrepositionRecord(req.ElapsedMs, req.Questions) {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgPrepositionRecordInvalid)
			return
		}
		saved, err := rs.AddPrepositionRecord(r.Context(), principalFrom(r.Context()).OwnerID, store.PrepositionRecord{
			PrepositionRecordSummary: store.PrepositionRecordSummary{ID: id, ElapsedMs: req.ElapsedMs, StartedAt: startedAt},
			Questions:                req.Questions,
		}, now())
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgPrepositionRecordNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toPrepositionRecordJSON(saved))
	})
}

// validPrepositionRecord checks a round's time and questions: each has an
// answer, a noun and a prompt, and at most three distinct misses, none of
// them the answer.
func validPrepositionRecord(elapsedMs int, questions []store.PrepositionQuestion) bool {
	if elapsedMs < 0 || time.Duration(elapsedMs)*time.Millisecond > maxPrepositionElapsed {
		return false
	}
	if len(questions) == 0 || len(questions) > maxPrepositionQuestions {
		return false
	}
	for _, q := range questions {
		if !boundedText(q.Answer, maxPrepositionAnswer) || !boundedText(q.Noun, maxPrepositionNoun) ||
			!boundedText(q.Prompt, maxPrepositionPrompt) || len(q.Misses) > maxPrepositionMisses {
			return false
		}
		seen := make(map[string]bool, len(q.Misses))
		for _, m := range q.Misses {
			if !boundedText(m, maxPrepositionAnswer) || m == q.Answer || seen[m] {
				return false
			}
			seen[m] = true
		}
	}
	return true
}

// boundedText is a non-empty s of at most max characters.
func boundedText(s string, max int) bool {
	n := utf8.RuneCountInString(s)
	return n > 0 && n <= max
}
