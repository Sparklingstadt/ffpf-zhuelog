package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// StudyLog is what the study log handler needs from *store.Store.
type StudyLog interface {
	StudyLog(ctx context.Context, ownerID string, from, to store.LogDate) ([]store.StudyDay, error)
}

var _ StudyLog = (*store.Store)(nil)

// maxStudyLogDays is the longest range one request reads: a calendar page
// is six weeks, so three months leaves room.
const maxStudyLogDays = 93

type studyDayJSON struct {
	Date              string `json:"date"`
	Reviews           int    `json:"reviews"`
	PracticeQuestions int    `json:"practiceQuestions"`
	Notes             int    `json:"notes"`
	Words             int    `json:"words"`
}

// listStudyLog returns what the owner did on each JST date from ?from to ?to
// (YYYY-MM-DD, both included, at most 93 days). Days with nothing are left
// out.
func listStudyLog(sl StudyLog) http.Handler {
	type response struct {
		Days []studyDayJSON `json:"days"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		from, okFrom := parseLogDate(q.Get("from"))
		to, okTo := parseLogDate(q.Get("to"))
		if !okFrom || !okTo {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgStudyLogInvalid)
			return
		}
		start := time.Date(from.Year, time.Month(from.Month), from.Day, 0, 0, 0, 0, time.UTC)
		end := time.Date(to.Year, time.Month(to.Month), to.Day, 0, 0, 0, 0, time.UTC)
		if end.Before(start) || end.Sub(start) >= maxStudyLogDays*24*time.Hour {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgStudyLogInvalid)
			return
		}
		days, err := sl.StudyLog(r.Context(), principalFrom(r.Context()).OwnerID, from, to)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{Days: make([]studyDayJSON, len(days))}
		for i, d := range days {
			out.Days[i] = studyDayJSON{
				Date: formatLogDate(d.Date), Reviews: d.Reviews, PracticeQuestions: d.PracticeQuestions,
				Notes: d.Notes, Words: d.Words,
			}
		}
		writeJSON(w, http.StatusOK, out)
	})
}
