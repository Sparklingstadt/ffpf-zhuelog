package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type fakeStudyLog struct {
	owner    string
	from, to store.LogDate
	days     []store.StudyDay
}

func (f *fakeStudyLog) StudyLog(_ context.Context, ownerID string, from, to store.LogDate) ([]store.StudyDay, error) {
	f.owner, f.from, f.to = ownerID, from, to
	return f.days, nil
}

func TestStudyLogRejectsGuests(t *testing.T) {
	h, _ := reviewRouter(t, auth.RoleGuest, Deps{StudyLog: &fakeStudyLog{}})
	wantError(t, do(h, "GET", "/v1/study-log?from=2026-11-01&to=2026-11-30", "", jsonAuth), http.StatusForbidden, "forbidden")
}

func TestStudyLog(t *testing.T) {
	sl := &fakeStudyLog{days: []store.StudyDay{
		{Date: store.LogDate{Year: 2026, Month: 11, Day: 2}, Reviews: 5, PracticeQuestions: 25, Notes: 1, Words: 2},
	}}
	h, _ := reviewRouter(t, auth.RoleMember, Deps{StudyLog: sl})

	w := do(h, "GET", "/v1/study-log?from=2026-10-27&to=2026-12-06", "", jsonAuth)
	var got struct {
		Days []map[string]any `json:"days"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || sl.owner != testOwner ||
		sl.from != (store.LogDate{Year: 2026, Month: 10, Day: 27}) || sl.to != (store.LogDate{Year: 2026, Month: 12, Day: 6}) {
		t.Fatalf("study log = %d %s (%+v..%+v)", w.Code, w.Body.String(), sl.from, sl.to)
	}
	if len(got.Days) != 1 || got.Days[0]["date"] != "2026-11-02" || got.Days[0]["reviews"] != float64(5) ||
		got.Days[0]["practiceQuestions"] != float64(25) || got.Days[0]["notes"] != float64(1) || got.Days[0]["words"] != float64(2) {
		t.Errorf("days = %s", w.Body.String())
	}

	// 93 days, both ends included, is the most.
	if w := do(h, "GET", "/v1/study-log?from=2026-01-01&to=2026-04-03", "", jsonAuth); w.Code != http.StatusOK {
		t.Errorf("93 days = %d %s", w.Code, w.Body.String())
	}
	for name, query := range map[string]string{
		"94 days":    "from=2026-01-01&to=2026-04-04",
		"backwards":  "from=2026-11-02&to=2026-11-01",
		"no from":    "to=2026-11-01",
		"not a date": "from=2026-11-31&to=2026-12-01",
		"not padded": "from=2026-11-1&to=2026-11-30",
	} {
		t.Run(name, func(t *testing.T) {
			wantError(t, do(h, "GET", "/v1/study-log?"+query, "", jsonAuth), http.StatusBadRequest, "invalid_request")
		})
	}
}
