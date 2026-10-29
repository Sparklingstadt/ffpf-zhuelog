package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// ComplementRecords is what the complement practice handlers need from
// *store.Store.
type ComplementRecords interface {
	ListComplementRecords(ctx context.Context, ownerID string, limit int) ([]store.ComplementRecordSummary, error)
	GetComplementRecord(ctx context.Context, ownerID, id string) (store.ComplementRecord, error)
	AddComplementRecord(ctx context.Context, ownerID string, r store.ComplementRecord, now time.Time) (store.ComplementRecord, error)
}

var _ ComplementRecords = (*store.Store)(nil)

const (
	// complementRecordListLimit is how many rounds the list returns.
	complementRecordListLimit = 100

	maxComplementQuestions = 50
	// A question has four choices, so at most three wrong picks.
	maxComplementMisses  = 3
	maxComplementAnswer  = 40
	maxComplementNoun    = 40
	maxComplementPrompt  = 100
	maxComplementElapsed = 24 * time.Hour
)

type complementRecordSummaryJSON struct {
	ID            string `json:"id"`
	Mode          string `json:"mode"`
	QuestionCount int    `json:"questionCount"`
	FirstTryCount int    `json:"firstTryCount"`
	MissCount     int    `json:"missCount"`
	ElapsedMs     int    `json:"elapsedMs"`
	StartedAt     string `json:"startedAt"`
	CreatedAt     string `json:"createdAt"`
}

type complementRecordJSON struct {
	complementRecordSummaryJSON
	Questions []store.ComplementQuestion `json:"questions"`
}

func toComplementRecordSummaryJSON(r store.ComplementRecordSummary) complementRecordSummaryJSON {
	return complementRecordSummaryJSON{
		ID: r.ID, Mode: r.Mode, QuestionCount: r.QuestionCount, FirstTryCount: r.FirstTryCount,
		MissCount: r.MissCount, ElapsedMs: r.ElapsedMs,
		StartedAt: formatTime(r.StartedAt), CreatedAt: formatTime(r.CreatedAt),
	}
}

func toComplementRecordJSON(r store.ComplementRecord) complementRecordJSON {
	return complementRecordJSON{
		complementRecordSummaryJSON: toComplementRecordSummaryJSON(r.ComplementRecordSummary),
		Questions:                   r.Questions,
	}
}

func listComplementRecords(rs ComplementRecords) http.Handler {
	type response struct {
		Records []complementRecordSummaryJSON `json:"records"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		list, err := rs.ListComplementRecords(r.Context(), principalFrom(r.Context()).OwnerID, complementRecordListLimit)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{Records: make([]complementRecordSummaryJSON, len(list))}
		for i, rec := range list {
			out.Records[i] = toComplementRecordSummaryJSON(rec)
		}
		writeJSON(w, http.StatusOK, out)
	})
}

func getComplementRecord(rs ComplementRecords) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgComplementRecordNotFound)
		if !ok {
			return
		}
		rec, err := rs.GetComplementRecord(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgComplementRecordNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toComplementRecordJSON(rec))
	})
}

// putComplementRecord saves the round the browser sends when its last
// question is answered. The id in the path names it, so a retry keeps one
// row; Go counts the misses and sets createdAt itself.
func putComplementRecord(rs ComplementRecords, now func() time.Time) http.Handler {
	type request struct {
		Mode      string                     `json:"mode"`
		StartedAt string                     `json:"startedAt"`
		ElapsedMs int                        `json:"elapsedMs"`
		Questions []store.ComplementQuestion `json:"questions"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgComplementRecordNotFound)
		if !ok {
			return
		}
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		startedAt, err := time.Parse(time.RFC3339Nano, req.StartedAt)
		if err != nil || !validComplementMode(req.Mode) || !validComplementRecord(req.ElapsedMs, req.Questions) {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgComplementRecordInvalid)
			return
		}
		saved, err := rs.AddComplementRecord(r.Context(), principalFrom(r.Context()).OwnerID, store.ComplementRecord{
			ComplementRecordSummary: store.ComplementRecordSummary{ID: id, Mode: req.Mode, ElapsedMs: req.ElapsedMs, StartedAt: startedAt},
			Questions:               req.Questions,
		}, now())
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgComplementRecordNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toComplementRecordJSON(saved))
	})
}

// validComplementRecord checks a round's time and questions: each has an
// answer, a noun and a prompt, and at most three distinct misses, none of
// them the answer.
func validComplementRecord(elapsedMs int, questions []store.ComplementQuestion) bool {
	if elapsedMs < 0 || elapsedMs > int(maxComplementElapsed/time.Millisecond) {
		return false
	}
	if len(questions) == 0 || len(questions) > maxComplementQuestions {
		return false
	}
	for _, q := range questions {
		if !boundedText(q.Answer, maxComplementAnswer) || !boundedText(q.Noun, maxComplementNoun) ||
			!boundedText(q.Prompt, maxComplementPrompt) || len(q.Misses) > maxComplementMisses {
			return false
		}
		seen := make(map[string]bool, len(q.Misses))
		for _, m := range q.Misses {
			if !boundedText(m, maxComplementAnswer) || m == q.Answer || seen[m] {
				return false
			}
			seen[m] = true
		}
	}
	return true
}

func validComplementMode(mode string) bool {
	return mode == "result" || mode == "potential" || mode == "degree"
}
