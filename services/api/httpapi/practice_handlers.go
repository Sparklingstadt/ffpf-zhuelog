package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// PracticeRecords is what the practice handlers need from *store.Store.
type PracticeRecords interface {
	ListPracticeRecords(ctx context.Context, kind store.PracticeKind, ownerID string, limit int) ([]store.PracticeRecordSummary, error)
	GetPracticeRecord(ctx context.Context, kind store.PracticeKind, ownerID, id string) (store.PracticeRecord, error)
	AddPracticeRecord(ctx context.Context, kind store.PracticeKind, ownerID string, r store.PracticeRecord, now time.Time) (store.PracticeRecord, error)
}

var _ PracticeRecords = (*store.Store)(nil)

const (
	// practiceRecordListLimit is how many rounds the list returns.
	practiceRecordListLimit = 100

	maxPracticeQuestions = 50
	// A question has four choices, so at most three wrong picks.
	maxPracticeMisses   = 3
	maxPracticeAnswer   = 10
	maxPracticeHeadword = 40
	maxPracticePrompt   = 100
	maxPracticeElapsed  = 24 * time.Hour
)

type practiceRecordSummaryJSON struct {
	ID            string `json:"id"`
	QuestionCount int    `json:"questionCount"`
	FirstTryCount int    `json:"firstTryCount"`
	MissCount     int    `json:"missCount"`
	ElapsedMs     int    `json:"elapsedMs"`
	StartedAt     string `json:"startedAt"`
	CreatedAt     string `json:"createdAt"`
}

type practiceRecordJSON struct {
	practiceRecordSummaryJSON
	Questions []store.PracticeQuestion `json:"questions"`
}

func toPracticeRecordSummaryJSON(r store.PracticeRecordSummary) practiceRecordSummaryJSON {
	return practiceRecordSummaryJSON{
		ID: r.ID, QuestionCount: r.QuestionCount, FirstTryCount: r.FirstTryCount,
		MissCount: r.MissCount, ElapsedMs: r.ElapsedMs,
		StartedAt: formatTime(r.StartedAt), CreatedAt: formatTime(r.CreatedAt),
	}
}

func toPracticeRecordJSON(r store.PracticeRecord) practiceRecordJSON {
	return practiceRecordJSON{
		practiceRecordSummaryJSON: toPracticeRecordSummaryJSON(r.PracticeRecordSummary),
		Questions:                 r.Questions,
	}
}

// listPracticeRecords serves the owner's rounds of one kind, newest first.
func listPracticeRecords(rs PracticeRecords, kind store.PracticeKind) http.Handler {
	type response struct {
		Records []practiceRecordSummaryJSON `json:"records"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		list, err := rs.ListPracticeRecords(r.Context(), kind, principalFrom(r.Context()).OwnerID, practiceRecordListLimit)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{Records: make([]practiceRecordSummaryJSON, len(list))}
		for i, rec := range list {
			out.Records[i] = toPracticeRecordSummaryJSON(rec)
		}
		writeJSON(w, http.StatusOK, out)
	})
}

func getPracticeRecord(rs PracticeRecords, kind store.PracticeKind) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgPracticeRecordNotFound)
		if !ok {
			return
		}
		rec, err := rs.GetPracticeRecord(r.Context(), kind, principalFrom(r.Context()).OwnerID, id)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgPracticeRecordNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toPracticeRecordJSON(rec))
	})
}

// putPracticeRecord saves the round the browser sends when its last question
// is answered. The id in the path names it, so a retry keeps one row; Go
// counts the misses and sets createdAt itself.
func putPracticeRecord(rs PracticeRecords, kind store.PracticeKind, now func() time.Time) http.Handler {
	type request struct {
		StartedAt string                   `json:"startedAt"`
		ElapsedMs int                      `json:"elapsedMs"`
		Questions []store.PracticeQuestion `json:"questions"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgPracticeRecordNotFound)
		if !ok {
			return
		}
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		startedAt, err := time.Parse(time.RFC3339Nano, req.StartedAt)
		if err != nil || !validPracticeRecord(req.ElapsedMs, req.Questions) {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgPracticeRecordInvalid)
			return
		}
		saved, err := rs.AddPracticeRecord(r.Context(), kind, principalFrom(r.Context()).OwnerID, store.PracticeRecord{
			PracticeRecordSummary: store.PracticeRecordSummary{ID: id, ElapsedMs: req.ElapsedMs, StartedAt: startedAt},
			Questions:             req.Questions,
		}, now())
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgPracticeRecordNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toPracticeRecordJSON(saved))
	})
}

// validPracticeRecord checks a round's time and questions: each has an
// answer, a headword and a prompt, and at most three distinct misses, none
// of them the answer.
func validPracticeRecord(elapsedMs int, questions []store.PracticeQuestion) bool {
	if elapsedMs < 0 || time.Duration(elapsedMs)*time.Millisecond > maxPracticeElapsed {
		return false
	}
	if len(questions) == 0 || len(questions) > maxPracticeQuestions {
		return false
	}
	for _, q := range questions {
		if !boundedText(q.Answer, maxPracticeAnswer) || !boundedText(q.Headword, maxPracticeHeadword) ||
			!boundedText(q.Prompt, maxPracticePrompt) || len(q.Misses) > maxPracticeMisses {
			return false
		}
		seen := make(map[string]bool, len(q.Misses))
		for _, m := range q.Misses {
			if !boundedText(m, maxPracticeAnswer) || m == q.Answer || seen[m] {
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
