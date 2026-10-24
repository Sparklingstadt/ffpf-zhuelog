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

// fakePrepositionRecords stores rounds by id for one owner at a time and
// counts the misses as the store does.
type fakePrepositionRecords struct {
	list     []store.PrepositionRecordSummary
	saved    map[string]store.PrepositionRecord
	addOwner string
	addNow   time.Time
}

func (f *fakePrepositionRecords) ListPrepositionRecords(_ context.Context, ownerID string, limit int) ([]store.PrepositionRecordSummary, error) {
	if limit != 100 {
		return nil, errUnexpectedCall{"ListPrepositionRecords limit"}
	}
	return f.list, nil
}

func (f *fakePrepositionRecords) GetPrepositionRecord(_ context.Context, ownerID, id string) (store.PrepositionRecord, error) {
	r, ok := f.saved[id]
	if !ok {
		return store.PrepositionRecord{}, store.ErrNotFound
	}
	return r, nil
}

func (f *fakePrepositionRecords) AddPrepositionRecord(_ context.Context, ownerID string, r store.PrepositionRecord, now time.Time) (store.PrepositionRecord, error) {
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
		f.saved = map[string]store.PrepositionRecord{}
	}
	f.saved[r.ID] = r
	return r, nil
}

func prepositionRouter(t *testing.T, role string, rs *fakePrepositionRecords) (http.Handler, *clock) {
	t.Helper()
	h, clk, _ := routerWith(t, role, Deps{PrepositionRecords: rs})
	return h, clk
}

func prepositionBody(t *testing.T, elapsedMs int, questions ...map[string]any) string {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"startedAt": "2026-10-20T11:58:00.000Z", "elapsedMs": elapsedMs, "questions": questions,
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func question(answer string, misses ...string) map[string]any {
	return map[string]any{"answer": answer, "noun": "学校", "prompt": "（　）学校学习", "misses": misses}
}

func TestPrepositionRecordRoutesRejectGuests(t *testing.T) {
	h, _ := prepositionRouter(t, auth.RoleGuest, &fakePrepositionRecords{})
	for _, rt := range []struct{ method, path, body string }{
		{"GET", "/v1/preposition-records", ""},
		{"GET", "/v1/preposition-records/" + testConversationID, ""},
		{"PUT", "/v1/preposition-records/" + testConversationID, prepositionBody(t, 1000, question("在"))},
	} {
		wantError(t, do(h, rt.method, rt.path, rt.body, jsonAuth), http.StatusForbidden, "forbidden")
	}
}

func TestPrepositionRecordSaveListAndGet(t *testing.T) {
	started := time.Date(2026, 10, 20, 11, 58, 0, 0, time.UTC)
	rs := &fakePrepositionRecords{list: []store.PrepositionRecordSummary{{
		ID: testConversationID, QuestionCount: 25, FirstTryCount: 20, MissCount: 7, ElapsedMs: 95_000,
		StartedAt: started, CreatedAt: started.Add(2 * time.Minute),
	}}}
	h, clk := prepositionRouter(t, auth.RoleMember, rs)

	w := do(h, "GET", "/v1/preposition-records", "", jsonAuth)
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

	wantError(t, do(h, "GET", "/v1/preposition-records/"+testConversationID, "", jsonAuth), http.StatusNotFound, "not_found")
	wantError(t, do(h, "GET", "/v1/preposition-records/not-a-uuid", "", jsonAuth), http.StatusNotFound, "not_found")

	body := prepositionBody(t, 83_250, question("在"), question("把", "被", "在"))
	w = do(h, "PUT", "/v1/preposition-records/"+testConversationID, body, jsonAuth)
	if w.Code != http.StatusOK || rs.addOwner != testOwner || !rs.addNow.Equal(clk.Now()) {
		t.Fatalf("put status %d, owner %q, now %v (body %s)", w.Code, rs.addOwner, rs.addNow, w.Body.String())
	}
	saved := rs.saved[testConversationID]
	if !saved.StartedAt.Equal(started) || saved.ElapsedMs != 83_250 || len(saved.Questions) != 2 ||
		strings.Join(saved.Questions[1].Misses, ",") != "被,在" {
		t.Errorf("saved = %+v", saved)
	}

	w = do(h, "GET", "/v1/preposition-records/"+testConversationID, "", jsonAuth)
	var got map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || got["firstTryCount"] != float64(1) || got["missCount"] != float64(2) ||
		len(got["questions"].([]any)) != 2 {
		t.Errorf("get = %d %s", w.Code, w.Body.String())
	}
}

func TestPrepositionRecordPutRejectsInvalidRounds(t *testing.T) {
	h, _ := prepositionRouter(t, auth.RoleAdmin, &fakePrepositionRecords{})
	path := "/v1/preposition-records/" + testConversationID
	many := make([]map[string]any, maxPrepositionQuestions+1)
	for i := range many {
		many[i] = question("在")
	}
	for name, body := range map[string]string{
		"no questions":       prepositionBody(t, 1000),
		"too many questions": prepositionBody(t, 1000, many...),
		"negative time":      prepositionBody(t, -1, question("在")),
		"over a day":         prepositionBody(t, int(maxPrepositionElapsed/time.Millisecond)+1, question("在")),
		"no answer":          prepositionBody(t, 1000, question("")),
		"answer as a miss":   prepositionBody(t, 1000, question("在", "在")),
		"repeated miss":      prepositionBody(t, 1000, question("在", "把", "把")),
		"four misses":        prepositionBody(t, 1000, question("在", "把", "被", "对", "向")),
		"empty miss":         prepositionBody(t, 1000, question("在", "")),
		"long prompt": prepositionBody(t, 1000, map[string]any{
			"answer": "在", "noun": "学校", "prompt": strings.Repeat("字", maxPrepositionPrompt+1),
		}),
		"bad startedAt": `{"startedAt":"yesterday","elapsedMs":1,"questions":[{"answer":"在","noun":"学校","prompt":"p"}]}`,
		"not JSON":      `{`,
	} {
		t.Run(name, func(t *testing.T) {
			wantError(t, do(h, "PUT", path, body, jsonAuth), http.StatusBadRequest, "invalid_request")
		})
	}
	wantError(t, do(h, "PUT", "/v1/preposition-records/not-a-uuid", prepositionBody(t, 1, question("在")), jsonAuth),
		http.StatusNotFound, "not_found")
	if w := do(h, "PUT", path, prepositionBody(t, 0, question("在", "把", "被", "对")), jsonAuth); w.Code != http.StatusOK {
		t.Errorf("three misses at 0 ms = %d %s", w.Code, w.Body.String())
	}
}
