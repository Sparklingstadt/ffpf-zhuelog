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

// fakePracticeRecords stores rounds by id for one owner at a time, counts
// the misses as the store does, and remembers the kind of every call.
type fakePracticeRecords struct {
	list     []store.PracticeRecordSummary
	saved    map[string]store.PracticeRecord
	kinds    map[string]store.PracticeKind
	listKind store.PracticeKind
	getKind  store.PracticeKind
	addOwner string
	addNow   time.Time
}

func (f *fakePracticeRecords) ListPracticeRecords(_ context.Context, kind store.PracticeKind, ownerID string, limit int) ([]store.PracticeRecordSummary, error) {
	if limit != 100 {
		return nil, errUnexpectedCall{"ListPracticeRecords limit"}
	}
	f.listKind = kind
	return f.list, nil
}

func (f *fakePracticeRecords) GetPracticeRecord(_ context.Context, kind store.PracticeKind, ownerID, id string) (store.PracticeRecord, error) {
	f.getKind = kind
	r, ok := f.saved[id]
	if !ok || f.kinds[id] != kind {
		return store.PracticeRecord{}, store.ErrNotFound
	}
	return r, nil
}

func (f *fakePracticeRecords) AddPracticeRecord(_ context.Context, kind store.PracticeKind, ownerID string, r store.PracticeRecord, now time.Time) (store.PracticeRecord, error) {
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
		f.saved = map[string]store.PracticeRecord{}
		f.kinds = map[string]store.PracticeKind{}
	}
	f.saved[r.ID] = r
	f.kinds[r.ID] = kind
	return r, nil
}

func practiceRouter(t *testing.T, role string, rs *fakePracticeRecords) (http.Handler, *clock) {
	t.Helper()
	h, clk, _ := routerWith(t, role, Deps{PracticeRecords: rs})
	return h, clk
}

func practiceBody(t *testing.T, elapsedMs int, questions ...map[string]any) string {
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
	return map[string]any{"answer": answer, "headword": "学校", "prompt": "（　）学校学习", "misses": misses}
}

// The two kinds' routes, each served by the same handlers for its kind.
var practiceRoutes = []struct {
	path string
	kind store.PracticeKind
}{
	{"/v1/preposition-records", store.PracticeKindPreposition},
	{"/v1/complement-records", store.PracticeKindComplement},
}

func TestPracticeRecordRoutesRejectGuests(t *testing.T) {
	h, _ := practiceRouter(t, auth.RoleGuest, &fakePracticeRecords{})
	for _, route := range practiceRoutes {
		for _, rt := range []struct{ method, path, body string }{
			{"GET", route.path, ""},
			{"GET", route.path + "/" + testConversationID, ""},
			{"PUT", route.path + "/" + testConversationID, practiceBody(t, 1000, question("在"))},
		} {
			wantError(t, do(h, rt.method, rt.path, rt.body, jsonAuth), http.StatusForbidden, "forbidden")
		}
	}
}

func TestPracticeRecordSaveListAndGet(t *testing.T) {
	for _, route := range practiceRoutes {
		t.Run(string(route.kind), func(t *testing.T) {
			started := time.Date(2026, 10, 20, 11, 58, 0, 0, time.UTC)
			rs := &fakePracticeRecords{list: []store.PracticeRecordSummary{{
				ID: testConversationID, QuestionCount: 25, FirstTryCount: 20, MissCount: 7, ElapsedMs: 95_000,
				StartedAt: started, CreatedAt: started.Add(2 * time.Minute),
			}}}
			h, clk := practiceRouter(t, auth.RoleMember, rs)

			w := do(h, "GET", route.path, "", jsonAuth)
			if w.Code != http.StatusOK || rs.listKind != route.kind {
				t.Fatalf("list status %d, kind %q", w.Code, rs.listKind)
			}
			var list struct {
				Records []map[string]any `json:"records"`
			}
			_ = json.Unmarshal(w.Body.Bytes(), &list)
			if len(list.Records) != 1 || list.Records[0]["missCount"] != float64(7) ||
				list.Records[0]["startedAt"] != "2026-10-20T11:58:00.000Z" || list.Records[0]["questions"] != nil {
				t.Errorf("list = %s", w.Body.String())
			}

			wantError(t, do(h, "GET", route.path+"/"+testConversationID, "", jsonAuth), http.StatusNotFound, "not_found")
			wantError(t, do(h, "GET", route.path+"/not-a-uuid", "", jsonAuth), http.StatusNotFound, "not_found")

			body := practiceBody(t, 83_250, question("在"), question("把", "被", "在"))
			w = do(h, "PUT", route.path+"/"+testConversationID, body, jsonAuth)
			if w.Code != http.StatusOK || rs.addOwner != testOwner || !rs.addNow.Equal(clk.Now()) || rs.kinds[testConversationID] != route.kind {
				t.Fatalf("put status %d, owner %q, now %v, kind %q (body %s)", w.Code, rs.addOwner, rs.addNow, rs.kinds[testConversationID], w.Body.String())
			}
			saved := rs.saved[testConversationID]
			if !saved.StartedAt.Equal(started) || saved.ElapsedMs != 83_250 || len(saved.Questions) != 2 ||
				saved.Questions[0].Headword != "学校" || strings.Join(saved.Questions[1].Misses, ",") != "被,在" {
				t.Errorf("saved = %+v", saved)
			}

			w = do(h, "GET", route.path+"/"+testConversationID, "", jsonAuth)
			var got map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &got)
			if w.Code != http.StatusOK || rs.getKind != route.kind || got["firstTryCount"] != float64(1) || got["missCount"] != float64(2) ||
				len(got["questions"].([]any)) != 2 || got["questions"].([]any)[0].(map[string]any)["headword"] != "学校" {
				t.Errorf("get = %d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestPracticeRecordPutRejectsInvalidRounds(t *testing.T) {
	h, _ := practiceRouter(t, auth.RoleAdmin, &fakePracticeRecords{})
	path := "/v1/complement-records/" + testConversationID
	many := make([]map[string]any, maxPracticeQuestions+1)
	for i := range many {
		many[i] = question("在")
	}
	for name, body := range map[string]string{
		"no questions":       practiceBody(t, 1000),
		"too many questions": practiceBody(t, 1000, many...),
		"negative time":      practiceBody(t, -1, question("在")),
		"over a day":         practiceBody(t, int(maxPracticeElapsed/time.Millisecond)+1, question("在")),
		"no answer":          practiceBody(t, 1000, question("")),
		"answer as a miss":   practiceBody(t, 1000, question("在", "在")),
		"repeated miss":      practiceBody(t, 1000, question("在", "把", "把")),
		"four misses":        practiceBody(t, 1000, question("在", "把", "被", "对", "向")),
		"empty miss":         practiceBody(t, 1000, question("在", "")),
		"long prompt": practiceBody(t, 1000, map[string]any{
			"answer": "在", "headword": "学校", "prompt": strings.Repeat("字", maxPracticePrompt+1),
		}),
		"no headword":   practiceBody(t, 1000, map[string]any{"answer": "在", "prompt": "p"}),
		"bad startedAt": `{"startedAt":"yesterday","elapsedMs":1,"questions":[{"answer":"在","headword":"学校","prompt":"p"}]}`,
		"not JSON":      `{`,
	} {
		t.Run(name, func(t *testing.T) {
			wantError(t, do(h, "PUT", path, body, jsonAuth), http.StatusBadRequest, "invalid_request")
		})
	}
	wantError(t, do(h, "PUT", "/v1/complement-records/not-a-uuid", practiceBody(t, 1, question("在")), jsonAuth),
		http.StatusNotFound, "not_found")
	if w := do(h, "PUT", path, practiceBody(t, 0, question("在", "把", "被", "对")), jsonAuth); w.Code != http.StatusOK {
		t.Errorf("three misses at 0 ms = %d %s", w.Code, w.Body.String())
	}
}
