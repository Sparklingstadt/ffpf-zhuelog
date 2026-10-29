package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// fakeComplementRecords stores rounds by id for one owner at a time and
// counts the misses as the store does.
type fakeComplementRecords struct {
	list     []store.ComplementRecordSummary
	saved    map[string]store.ComplementRecord
	addOwner string
	addNow   time.Time
}

func (f *fakeComplementRecords) ListComplementRecords(_ context.Context, ownerID string, limit int) ([]store.ComplementRecordSummary, error) {
	if limit != 100 {
		return nil, errUnexpectedCall{"ListComplementRecords limit"}
	}
	return f.list, nil
}

func (f *fakeComplementRecords) GetComplementRecord(_ context.Context, ownerID, id string) (store.ComplementRecord, error) {
	r, ok := f.saved[id]
	if !ok {
		return store.ComplementRecord{}, store.ErrNotFound
	}
	return r, nil
}

func (f *fakeComplementRecords) AddComplementRecord(_ context.Context, ownerID string, r store.ComplementRecord, now time.Time) (store.ComplementRecord, error) {
	f.addOwner, f.addNow = ownerID, now
	r.QuestionCount, r.FirstTryCount, r.MissCount = len(r.Questions), 0, 0
	for _, q := range r.Questions {
		if len(q.Misses) == 0 {
			r.FirstTryCount++
		}
		r.MissCount += len(q.Misses)
	}
	r.CreatedAt = now
	if f.saved == nil {
		f.saved = map[string]store.ComplementRecord{}
	}
	f.saved[r.ID] = r
	return r, nil
}

func complementRouter(t *testing.T, role string, rs *fakeComplementRecords) (http.Handler, *clock) {
	t.Helper()
	h, clk, _ := routerWith(t, role, Deps{ComplementRecords: rs})
	return h, clk
}

func complementBody(t *testing.T, elapsedMs int, questions ...map[string]any) string {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"mode": "result", "startedAt": "2026-10-20T11:58:00.000Z", "elapsedMs": elapsedMs, "questions": questions,
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func complementQuestion(answer string, misses ...string) map[string]any {
	return map[string]any{"answer": answer, "noun": "学校", "prompt": "（　）学校学习", "misses": misses}
}

func TestComplementRecordRoutesRejectGuests(t *testing.T) {
	h, _ := complementRouter(t, auth.RoleGuest, &fakeComplementRecords{})
	for _, rt := range []struct{ method, path, body string }{
		{"GET", "/v1/complement-records", ""},
		{"GET", "/v1/complement-records/" + testConversationID, ""},
		{"PUT", "/v1/complement-records/" + testConversationID, complementBody(t, 1000, complementQuestion("在"))},
	} {
		wantError(t, do(h, rt.method, rt.path, rt.body, jsonAuth), http.StatusForbidden, "forbidden")
	}
}

func TestComplementRecordSaveListAndGet(t *testing.T) {
	started := time.Date(2026, 10, 20, 11, 58, 0, 0, time.UTC)
	rs := &fakeComplementRecords{list: []store.ComplementRecordSummary{{
		Mode: "result", ID: testConversationID, QuestionCount: 25, FirstTryCount: 20, MissCount: 7, ElapsedMs: 95_000,
		StartedAt: started, CreatedAt: started.Add(2 * time.Minute),
	}}}
	h, clk := complementRouter(t, auth.RoleMember, rs)

	w := do(h, "GET", "/v1/complement-records", "", jsonAuth)
	if w.Code != http.StatusOK {
		t.Fatalf("list status %d", w.Code)
	}
	var list struct {
		Records []map[string]any `json:"records"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if len(list.Records) != 1 || list.Records[0]["missCount"] != float64(7) ||
		list.Records[0]["startedAt"] != "2026-10-20T11:58:00.000Z" || list.Records[0]["questions"] != nil {
		t.Errorf("list = %s", w.Body.String())
	}

	wantError(t, do(h, "GET", "/v1/complement-records/"+testConversationID, "", jsonAuth), http.StatusNotFound, "not_found")
	wantError(t, do(h, "GET", "/v1/complement-records/not-a-uuid", "", jsonAuth), http.StatusNotFound, "not_found")

	body := complementBody(t, 83_250, complementQuestion("在"), complementQuestion("把", "被", "在"))
	w = do(h, "PUT", "/v1/complement-records/"+testConversationID, body, jsonAuth)
	if w.Code != http.StatusOK || rs.addOwner != testOwner || !rs.addNow.Equal(clk.Now()) {
		t.Fatalf("put status %d, owner %q, now %v (body %s)", w.Code, rs.addOwner, rs.addNow, w.Body.String())
	}
	saved := rs.saved[testConversationID]
	if !saved.StartedAt.Equal(started) || saved.ElapsedMs != 83_250 || len(saved.Questions) != 2 ||
		strings.Join(saved.Questions[1].Misses, ",") != "被,在" {
		t.Errorf("saved = %+v", saved)
	}

	w = do(h, "GET", "/v1/complement-records/"+testConversationID, "", jsonAuth)
	var got map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || got["mode"] != "result" || got["firstTryCount"] != float64(1) || got["missCount"] != float64(2) ||
		len(got["questions"].([]any)) != 2 {
		t.Errorf("get = %d %s", w.Code, w.Body.String())
	}
}

func TestComplementRecordPutRejectsInvalidRounds(t *testing.T) {
	h, _ := complementRouter(t, auth.RoleAdmin, &fakeComplementRecords{})
	path := "/v1/complement-records/" + testConversationID
	many := make([]map[string]any, maxComplementQuestions+1)
	for i := range many {
		many[i] = complementQuestion("在")
	}
	for name, body := range map[string]string{
		"invalid mode":       `{ "mode":"unknown", "startedAt":"2026-10-20T11:58:00.000Z", "elapsedMs":1, "questions":[{"answer":"完","noun":"結果補語","prompt":"写（　）"}] }`,
		"no questions":       complementBody(t, 1000),
		"too many questions": complementBody(t, 1000, many...),
		"negative time":      complementBody(t, -1, complementQuestion("在")),
		"over a day":         complementBody(t, int(maxComplementElapsed/time.Millisecond)+1, complementQuestion("在")),
		"no answer":          complementBody(t, 1000, complementQuestion("")),
		"answer as a miss":   complementBody(t, 1000, complementQuestion("在", "在")),
		"repeated miss":      complementBody(t, 1000, complementQuestion("在", "把", "把")),
		"four misses":        complementBody(t, 1000, complementQuestion("在", "把", "被", "对", "向")),
		"empty miss":         complementBody(t, 1000, complementQuestion("在", "")),
		"long prompt": complementBody(t, 1000, map[string]any{
			"answer": "在", "noun": "学校", "prompt": strings.Repeat("字", maxComplementPrompt+1),
		}),
		"bad startedAt": `{"startedAt":"yesterday","elapsedMs":1,"questions":[{"answer":"在","noun":"学校","prompt":"p"}]}`,
		"not JSON":      `{`,
	} {
		t.Run(name, func(t *testing.T) {
			wantError(t, do(h, "PUT", path, body, jsonAuth), http.StatusBadRequest, "invalid_request")
		})
	}
	wantError(t, do(h, "PUT", "/v1/complement-records/not-a-uuid", complementBody(t, 1, complementQuestion("在")), jsonAuth),
		http.StatusNotFound, "not_found")
	if w := do(h, "PUT", path, complementBody(t, 0, complementQuestion("在", "把", "被", "对")), jsonAuth); w.Code != http.StatusOK {
		t.Errorf("three misses at 0 ms = %d %s", w.Code, w.Body.String())
	}
}
