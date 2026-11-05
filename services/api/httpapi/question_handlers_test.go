package httpapi

import (
	"context"
	"encoding/json"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
	"net/http"
	"strings"
	"testing"
	"time"
)

type fakeQuestions struct {
	saved store.Question
	owner string
}

func (f *fakeQuestions) ListQuestions(_ context.Context, owner string, _ int) ([]store.QuestionSummary, error) {
	f.owner = owner
	return []store.QuestionSummary{f.saved.QuestionSummary}, nil
}
func (f *fakeQuestions) GetQuestion(_ context.Context, owner, id string) (store.Question, error) {
	f.owner = owner
	if f.saved.ID != id {
		return store.Question{}, store.ErrNotFound
	}
	return f.saved, nil
}
func (f *fakeQuestions) PutQuestion(_ context.Context, owner string, q store.Question, now time.Time) (store.Question, error) {
	f.owner = owner
	q.CreatedAt = now
	f.saved = q
	return q, nil
}
func questionRouter(t *testing.T, role string, c *fakeChat, qs *fakeQuestions) http.Handler {
	h, _, _ := routerWith(t, role, Deps{QuickChat: c, Questions: qs, ChatModel: "gpt-test"})
	return h
}
func TestQuestionRoutesRejectGuestsAndAnonymous(t *testing.T) {
	for _, role := range []string{auth.RoleGuest, auth.RoleAdmin} {
		h := questionRouter(t, role, &fakeChat{}, &fakeQuestions{})
		for _, route := range []struct{ method, path string }{{"POST", "/v1/quick-question"}, {"GET", "/v1/questions"}, {"GET", "/v1/questions/" + testConversationID}, {"PUT", "/v1/questions/" + testConversationID}} {
			headers, status, code := jsonAuth, 403, "forbidden"
			if role == auth.RoleAdmin {
				headers, status, code = nil, 401, "unauthorized"
			}
			wantError(t, do(h, route.method, route.path, `{}`, headers), status, code)
		}
	}
}
func TestQuickQuestionAcceptsOnlyOneQuestion(t *testing.T) {
	c := &fakeChat{pieces: []string{"答え"}}
	h := questionRouter(t, auth.RoleMember, c, &fakeQuestions{})
	w := do(h, "POST", "/v1/quick-question", oneUserMessage, jsonAuth)
	if w.Code != 200 || len(ndjsonLines(t, w.Body.String())) != 2 || len(c.got) != 1 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	for _, body := range []string{`{"messages":[]}`, `{"messages":[{"role":"assistant","text":"答え"}]}`, `{"messages":[{"role":"user","text":"一"},{"role":"assistant","text":"答え"},{"role":"user","text":"二"}]}`, `{"messages":[{"role":"user","text":"` + strings.Repeat("字", 4001) + `"}]}`} {
		wantError(t, do(h, "POST", "/v1/quick-question", body, jsonAuth), 400, "invalid_request")
	}
}
func TestQuestionSaveAndReadUsesAuthenticatedOwnerAndServerModel(t *testing.T) {
	qs := &fakeQuestions{}
	h := questionRouter(t, auth.RoleMember, &fakeChat{}, qs)
	path := "/v1/questions/" + testConversationID
	w := do(h, "PUT", path, `{"question":" 了と过？ ","answer":" 違いです。 "}`, jsonAuth)
	if w.Code != 200 || qs.owner != testOwner || qs.saved.ModelName != "gpt-test" || qs.saved.Question != "了と过？" || qs.saved.CreatedAt.IsZero() {
		t.Fatalf("%d %s %+v", w.Code, w.Body.String(), qs)
	}
	if w := do(h, "GET", path, "", jsonAuth); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = do(h, "GET", "/v1/questions", "", jsonAuth)
	var list struct {
		Questions []map[string]any `json:"questions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || len(list.Questions) != 1 || list.Questions[0]["answer"] != nil {
		t.Fatalf("summary: %s", w.Body.String())
	}
	for _, body := range []string{`{}`, `{"question":"x","answer":""}`, `{"question":"x","answer":"` + strings.Repeat("字", 20001) + `"}`, `{"question":"` + strings.Repeat("字", 4001) + `","answer":"x"}`} {
		wantError(t, do(h, "PUT", path, body, jsonAuth), 400, "invalid_request")
	}
	wantError(t, do(h, "GET", "/v1/questions/00000000-0000-4000-8000-000000000000", "", jsonAuth), 404, "not_found")
	wantError(t, do(h, "GET", "/v1/questions?user=other", "", jsonAuth), 400, "invalid_request")
}
func TestQuickQuestionRoutesMissingWithoutConfiguration(t *testing.T) {
	h, _, _ := routerWith(t, auth.RoleAdmin, Deps{})
	wantError(t, do(h, "POST", "/v1/quick-question", oneUserMessage, jsonAuth), 404, "not_found")
}
