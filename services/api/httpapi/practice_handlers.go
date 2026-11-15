package httpapi

import (
	"context"
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

// ComplementRecords is what the complement practice handlers need from
// *store.Store.
type ComplementRecords interface {
	ListComplementRecords(ctx context.Context, ownerID string, limit int) ([]store.ComplementRecordSummary, error)
	GetComplementRecord(ctx context.Context, ownerID, id string) (store.ComplementRecord, error)
	AddComplementRecord(ctx context.Context, ownerID string, r store.ComplementRecord, now time.Time) (store.ComplementRecord, error)
}

var (
	_ PrepositionRecords = (*store.Store)(nil)
	_ ComplementRecords  = (*store.Store)(nil)
)

const (
	// practiceRecordListLimit is how many rounds the list returns.
	practiceRecordListLimit = 100

	maxPracticeQuestions = 50
	// A question has four choices, so at most three wrong picks.
	maxPracticeMisses  = 3
	maxPracticeID      = 40
	maxPracticeNoun    = 40
	maxPracticePrompt  = 100
	maxPracticeElapsed = 24 * time.Hour
)

// practiceSpec is what differs between the kinds of practice whose rounds are
// saved: how long an answer (and so a miss) may be, the modes a round may
// have (nil: rounds have no mode, and a "mode" in the body is an unknown
// field), which of the missed questions go to the review queue, and the
// store calls for the record type R.
type practiceSpec[R any] struct {
	maxAnswer     int
	modes         map[string]bool
	reviewTargets func([]store.PracticeQuestion) []store.ReviewTarget

	list  func(ctx context.Context, ownerID string, limit int) ([]store.PracticeRecordSummary, error)
	get   func(ctx context.Context, ownerID, id string) (R, error)
	add   func(ctx context.Context, ownerID string, r R, now time.Time) (R, error)
	build func(store.PracticeRecordSummary, []store.PracticeQuestion) R
	parts func(R) (store.PracticeRecordSummary, []store.PracticeQuestion)
}

// The store calls are closures so that a nil store only fails when a route
// is used, as before.

func prepositionPractice(rs PrepositionRecords) practiceSpec[store.PrepositionRecord] {
	return practiceSpec[store.PrepositionRecord]{
		maxAnswer:     10,
		reviewTargets: prepositionReviewTargets,
		list: func(ctx context.Context, ownerID string, limit int) ([]store.PracticeRecordSummary, error) {
			return rs.ListPrepositionRecords(ctx, ownerID, limit)
		},
		get: func(ctx context.Context, ownerID, id string) (store.PrepositionRecord, error) {
			return rs.GetPrepositionRecord(ctx, ownerID, id)
		},
		add: func(ctx context.Context, ownerID string, r store.PrepositionRecord, now time.Time) (store.PrepositionRecord, error) {
			return rs.AddPrepositionRecord(ctx, ownerID, r, now)
		},
		build: func(s store.PracticeRecordSummary, qs []store.PracticeQuestion) store.PrepositionRecord {
			return store.PrepositionRecord{PrepositionRecordSummary: s, Questions: qs}
		},
		parts: func(r store.PrepositionRecord) (store.PracticeRecordSummary, []store.PracticeQuestion) {
			return r.PrepositionRecordSummary, r.Questions
		},
	}
}

func complementPractice(rs ComplementRecords) practiceSpec[store.ComplementRecord] {
	return practiceSpec[store.ComplementRecord]{
		maxAnswer:     40,
		modes:         complementModes,
		reviewTargets: complementReviewTargets,
		list: func(ctx context.Context, ownerID string, limit int) ([]store.PracticeRecordSummary, error) {
			return rs.ListComplementRecords(ctx, ownerID, limit)
		},
		get: func(ctx context.Context, ownerID, id string) (store.ComplementRecord, error) {
			return rs.GetComplementRecord(ctx, ownerID, id)
		},
		add: func(ctx context.Context, ownerID string, r store.ComplementRecord, now time.Time) (store.ComplementRecord, error) {
			return rs.AddComplementRecord(ctx, ownerID, r, now)
		},
		build: func(s store.PracticeRecordSummary, qs []store.PracticeQuestion) store.ComplementRecord {
			return store.ComplementRecord{ComplementRecordSummary: s, Questions: qs}
		},
		parts: func(r store.ComplementRecord) (store.PracticeRecordSummary, []store.PracticeQuestion) {
			return r.ComplementRecordSummary, r.Questions
		},
	}
}

var complementModes = map[string]bool{
	"result": true, "potential": true, "degree": true,
	"direction-simple": true, "direction-compound": true,
	"direction-simple-extended": true, "direction-compound-extended": true,
	// 動詞から選ぶ: built from the complement CSV, like the prepositions.
	"verb": true,
	// The measure-word and 了・过・着 practices keep their rounds with the
	// complements'.
	"measure": true, "aspect": true,
}

// practiceRecordSummaryJSON is a round without its questions. Mode is nil for
// kinds without modes, which leaves "mode" out of the JSON.
type practiceRecordSummaryJSON struct {
	ID            string  `json:"id"`
	Mode          *string `json:"mode,omitempty"`
	QuestionCount int     `json:"questionCount"`
	FirstTryCount int     `json:"firstTryCount"`
	MissCount     int     `json:"missCount"`
	ElapsedMs     int     `json:"elapsedMs"`
	StartedAt     string  `json:"startedAt"`
	CreatedAt     string  `json:"createdAt"`
}

type practiceRecordJSON struct {
	practiceRecordSummaryJSON
	Questions []store.PracticeQuestion `json:"questions"`
}

func (p practiceSpec[R]) summaryJSON(r store.PracticeRecordSummary) practiceRecordSummaryJSON {
	out := practiceRecordSummaryJSON{
		ID: r.ID, QuestionCount: r.QuestionCount, FirstTryCount: r.FirstTryCount,
		MissCount: r.MissCount, ElapsedMs: r.ElapsedMs,
		StartedAt: formatTime(r.StartedAt), CreatedAt: formatTime(r.CreatedAt),
	}
	if p.modes != nil {
		out.Mode = &r.Mode
	}
	return out
}

func (p practiceSpec[R]) recordJSON(r R) practiceRecordJSON {
	sum, qs := p.parts(r)
	return practiceRecordJSON{practiceRecordSummaryJSON: p.summaryJSON(sum), Questions: qs}
}

func listPracticeRecords[R any](p practiceSpec[R]) http.Handler {
	type response struct {
		Records []practiceRecordSummaryJSON `json:"records"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		list, err := p.list(r.Context(), principalFrom(r.Context()).OwnerID, practiceRecordListLimit)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{Records: make([]practiceRecordSummaryJSON, len(list))}
		for i, rec := range list {
			out.Records[i] = p.summaryJSON(rec)
		}
		writeJSON(w, http.StatusOK, out)
	})
}

func getPracticeRecord[R any](p practiceSpec[R]) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validUUID, msgPracticeRecordNotFound)
		if !ok {
			return
		}
		rec, err := p.get(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if err != nil {
			writeStoreError(w, r, err, msgPracticeRecordNotFound)
			return
		}
		writeJSON(w, http.StatusOK, p.recordJSON(rec))
	})
}

// putPracticeRecord saves the round the browser sends when its last question
// is answered. The id in the path names it, so a retry keeps one row; Go
// counts the misses and sets createdAt itself.
func putPracticeRecord[R any](p practiceSpec[R], rv Reviews, now func() time.Time) http.Handler {
	type round struct {
		StartedAt string                   `json:"startedAt"`
		ElapsedMs int                      `json:"elapsedMs"`
		Questions []store.PracticeQuestion `json:"questions"`
	}
	type withMode struct {
		Mode string `json:"mode"`
		round
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validUUID, msgPracticeRecordNotFound)
		if !ok {
			return
		}
		var req withMode
		var dst any = &req.round
		if p.modes != nil {
			dst = &req
		}
		if err := decodeBody(r, dst); err != nil {
			writeBodyError(w, r, err)
			return
		}
		startedAt, err := time.Parse(time.RFC3339Nano, req.StartedAt)
		if err != nil || (p.modes != nil && !p.modes[req.Mode]) || !p.validRound(req.ElapsedMs, req.Questions) {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgPracticeRecordInvalid)
			return
		}
		saved, err := p.add(r.Context(), principalFrom(r.Context()).OwnerID, p.build(
			store.PracticeRecordSummary{ID: id, Mode: req.Mode, ElapsedMs: req.ElapsedMs, StartedAt: startedAt},
			req.Questions,
		), now())
		if err != nil {
			writeStoreError(w, r, err, msgPracticeRecordNotFound)
			return
		}
		// Missed questions go to the review queue. The saved round's questions
		// are used, so a retry queues what the first save did; a failure here
		// fails the save, and the retry queues them then.
		_, savedQuestions := p.parts(saved)
		if err := queueReviews(r.Context(), rv, principalFrom(r.Context()).OwnerID, p.reviewTargets(savedQuestions), now()); err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, p.recordJSON(saved))
	})
}

// validRound checks a round's time and questions: each has an answer, a noun
// and a prompt, at most three distinct misses, none of them the answer, and
// an id that is short enough when it has one.
func (p practiceSpec[R]) validRound(elapsedMs int, questions []store.PracticeQuestion) bool {
	if elapsedMs < 0 || elapsedMs > int(maxPracticeElapsed/time.Millisecond) {
		return false
	}
	if len(questions) == 0 || len(questions) > maxPracticeQuestions {
		return false
	}
	for _, q := range questions {
		if utf8.RuneCountInString(q.ID) > maxPracticeID || !boundedText(q.Answer, p.maxAnswer) || !boundedText(q.Noun, maxPracticeNoun) ||
			!boundedText(q.Prompt, maxPracticePrompt) || len(q.Misses) > maxPracticeMisses {
			return false
		}
		seen := make(map[string]bool, len(q.Misses))
		for _, m := range q.Misses {
			if !boundedText(m, p.maxAnswer) || m == q.Answer || seen[m] {
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
