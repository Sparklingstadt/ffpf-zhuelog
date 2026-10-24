package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/chat"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const testConversationID = "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f"

// fakeChat emits its pieces, then returns err.
type fakeChat struct {
	pieces []string
	err    error
	got    []chat.Message
	ctxErr error
}

func (f *fakeChat) Stream(ctx context.Context, msgs []chat.Message, emit func(string) error) error {
	f.got = msgs
	for _, p := range f.pieces {
		if err := emit(p); err != nil {
			return err
		}
	}
	f.ctxErr = ctx.Err()
	return f.err
}

// fakeConversations stores conversations by id for one owner at a time.
type fakeConversations struct {
	list      []store.ConversationSummary
	saved     map[string]store.Conversation
	putOwner  string
	putNow    time.Time
	deleteErr error
}

func (f *fakeConversations) ListConversations(_ context.Context, ownerID string, limit int) ([]store.ConversationSummary, error) {
	if limit != 100 {
		return nil, errUnexpectedCall{"ListConversations limit"}
	}
	return f.list, nil
}

func (f *fakeConversations) GetConversation(_ context.Context, ownerID, id string) (store.Conversation, error) {
	c, ok := f.saved[id]
	if !ok {
		return store.Conversation{}, store.ErrNotFound
	}
	return c, nil
}

func (f *fakeConversations) PutConversation(_ context.Context, ownerID string, c store.Conversation, now time.Time) (store.Conversation, error) {
	f.putOwner, f.putNow = ownerID, now
	c.UpdatedAt = now
	if f.saved == nil {
		f.saved = map[string]store.Conversation{}
	}
	f.saved[c.ID] = c
	return c, nil
}

func (f *fakeConversations) DeleteConversation(_ context.Context, ownerID, id string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.saved[id]; !ok {
		return store.ErrNotFound
	}
	delete(f.saved, id)
	return nil
}

func chatRouter(t *testing.T, role string, c *fakeChat, conv *fakeConversations) (http.Handler, *clock) {
	t.Helper()
	h, clk, _ := routerWith(t, role, Deps{Chat: c, Conversations: conv, ChatModel: "gpt-test"})
	return h, clk
}

var jsonAuth = map[string]string{"Authorization": "Bearer tok", "Content-Type": "application/json"}

func ndjsonLines(t *testing.T, body string) []map[string]string {
	t.Helper()
	var out []map[string]string
	for _, line := range strings.Split(strings.TrimSuffix(body, "\n"), "\n") {
		var v map[string]string
		if err := json.Unmarshal([]byte(line), &v); err != nil {
			t.Fatalf("line %q: %v", line, err)
		}
		out = append(out, v)
	}
	return out
}

const oneUserMessage = `{"messages":[{"role":"user","text":"你好"}]}`

func TestChatRoutesAreAdminOnly(t *testing.T) {
	for _, role := range []string{auth.RoleMember, auth.RoleGuest} {
		h, _ := chatRouter(t, role, &fakeChat{}, &fakeConversations{})
		for _, rt := range []struct{ method, path, body string }{
			{"POST", "/v1/chat", oneUserMessage},
			{"GET", "/v1/conversations", ""},
			{"GET", "/v1/conversations/" + testConversationID, ""},
			{"PUT", "/v1/conversations/" + testConversationID, `{}`},
			{"DELETE", "/v1/conversations/" + testConversationID, ""},
		} {
			wantError(t, do(h, rt.method, rt.path, rt.body, jsonAuth), http.StatusForbidden, "forbidden")
		}
	}
}

func TestChatRoutesMissingWithoutStreamer(t *testing.T) {
	h, _, _ := routerWith(t, auth.RoleAdmin, Deps{})
	wantError(t, do(h, "POST", "/v1/chat", oneUserMessage, jsonAuth), http.StatusNotFound, "not_found")
	wantError(t, do(h, "GET", "/v1/conversations", "", jsonAuth), http.StatusNotFound, "not_found")
}

func TestChatStreamsNDJSONAndDone(t *testing.T) {
	c := &fakeChat{pieces: []string{"你", "好"}}
	h, _ := chatRouter(t, auth.RoleAdmin, c, &fakeConversations{})
	w := do(h, "POST", "/v1/chat", `{"messages":[{"role":"user","text":"你好"},{"role":"assistant","text":"嗯"},{"role":"user","text":"再见"}]}`, jsonAuth)
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "application/x-ndjson; charset=utf-8" {
		t.Fatalf("status %d, content-type %q", w.Code, w.Header().Get("Content-Type"))
	}
	if !w.Flushed {
		t.Error("the stream was never flushed")
	}
	lines := ndjsonLines(t, w.Body.String())
	want := []map[string]string{{"type": "delta", "text": "你"}, {"type": "delta", "text": "好"}, {"type": "done"}}
	if len(lines) != 3 || lines[0]["text"] != "你" || lines[1]["text"] != "好" || lines[2]["type"] != "done" {
		t.Fatalf("lines = %v, want %v", lines, want)
	}
	if len(c.got) != 3 || c.got[2] != (chat.Message{Role: "user", Text: "再见"}) {
		t.Errorf("streamer got %v", c.got)
	}
}

func TestChatErrorBeforeWritingIs502(t *testing.T) {
	h, _ := chatRouter(t, auth.RoleAdmin, &fakeChat{err: &chat.Error{Code: "OPENAI_TIMEOUT"}}, &fakeConversations{})
	w := do(h, "POST", "/v1/chat", oneUserMessage, jsonAuth)
	wantError(t, w, http.StatusBadGateway, "chat_failed")
	if got := decodeError(t, w).Error.Message; got != msgChatFailed {
		t.Errorf("message = %q", got)
	}
}

func TestChatErrorAfterWritingIsErrorLine(t *testing.T) {
	h, _ := chatRouter(t, auth.RoleAdmin, &fakeChat{pieces: []string{"你"}, err: &chat.Error{Code: "OPENAI_INVALID_RESPONSE"}}, &fakeConversations{})
	w := do(h, "POST", "/v1/chat", oneUserMessage, jsonAuth)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	lines := ndjsonLines(t, w.Body.String())
	last := lines[len(lines)-1]
	if len(lines) != 2 || last["type"] != "error" || last["message"] != msgChatFailed {
		t.Fatalf("lines = %v", lines)
	}
}

func TestChatRejectsInvalidAndLarge(t *testing.T) {
	h, _ := chatRouter(t, auth.RoleAdmin, &fakeChat{}, &fakeConversations{})
	w := do(h, "POST", "/v1/chat", `{"messages":[{"role":"user","text":"你好"},{"role":"assistant","text":"嗯"}]}`, jsonAuth)
	wantError(t, w, http.StatusBadRequest, "invalid_request")
	if got := decodeError(t, w).Error.Message; got != msgChatInvalid {
		t.Errorf("message = %q", got)
	}
	big := `{"messages":[{"role":"user","text":"` + strings.Repeat("a", chatBodyLimit) + `"}]}`
	wantError(t, do(h, "POST", "/v1/chat", big, jsonAuth), http.StatusRequestEntityTooLarge, "too_large")
}

func TestChatPassesRequestContext(t *testing.T) {
	c := &fakeChat{}
	h, _ := chatRouter(t, auth.RoleAdmin, c, &fakeConversations{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, _ := http.NewRequestWithContext(ctx, "POST", "/v1/chat", strings.NewReader(oneUserMessage))
	for k, v := range jsonAuth {
		r.Header.Set(k, v)
	}
	h.ServeHTTP(&discardWriter{header: http.Header{}}, r)
	if c.ctxErr == nil {
		t.Fatal("the streamer's context was not the request's")
	}
}

// discardWriter is a ResponseWriter that drops everything.
type discardWriter struct{ header http.Header }

func (d *discardWriter) Header() http.Header         { return d.header }
func (d *discardWriter) Write(b []byte) (int, error) { return len(b), nil }
func (d *discardWriter) WriteHeader(int)             {}

const savedBody = `{"title":"你好","modelName":"gpt-test","ended":false,"createdAt":"2026-10-20T11:00:00.000Z",` +
	`"messages":[{"id":"m1","role":"user","text":"你好"},{"id":"m2","role":"assistant","text":"你好！"}]}`

func TestConversationCRUD(t *testing.T) {
	created := time.Date(2026, 10, 20, 11, 0, 0, 0, time.UTC)
	conv := &fakeConversations{list: []store.ConversationSummary{{
		ID: testConversationID, Title: "你好", ModelName: "gpt-test", CreatedAt: created, UpdatedAt: created,
	}}}
	h, clk := chatRouter(t, auth.RoleAdmin, &fakeChat{}, conv)

	w := do(h, "GET", "/v1/conversations", "", jsonAuth)
	if w.Code != http.StatusOK {
		t.Fatalf("list status %d", w.Code)
	}
	var list struct {
		ChatModel     string           `json:"chatModel"`
		Conversations []map[string]any `json:"conversations"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if list.ChatModel != "gpt-test" || len(list.Conversations) != 1 ||
		list.Conversations[0]["createdAt"] != "2026-10-20T11:00:00.000Z" || list.Conversations[0]["messages"] != nil {
		t.Errorf("list = %s", w.Body.String())
	}

	wantError(t, do(h, "GET", "/v1/conversations/"+testConversationID, "", jsonAuth), http.StatusNotFound, "not_found")
	wantError(t, do(h, "GET", "/v1/conversations/not-a-uuid", "", jsonAuth), http.StatusNotFound, "not_found")

	w = do(h, "PUT", "/v1/conversations/"+testConversationID, savedBody, jsonAuth)
	if w.Code != http.StatusOK || conv.putOwner != testOwner || !conv.putNow.Equal(clk.Now()) {
		t.Fatalf("put status %d, owner %q, now %v (body %s)", w.Code, conv.putOwner, conv.putNow, w.Body.String())
	}
	saved := conv.saved[testConversationID]
	if !saved.CreatedAt.Equal(created) || len(saved.Messages) != 2 || saved.Messages[1].Text != "你好！" {
		t.Errorf("saved = %+v", saved)
	}

	w = do(h, "GET", "/v1/conversations/"+testConversationID, "", jsonAuth)
	var got map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || got["title"] != "你好" || len(got["messages"].([]any)) != 2 {
		t.Errorf("get = %d %s", w.Code, w.Body.String())
	}

	for name, body := range map[string]string{
		"long title":   strings.Replace(savedBody, `"title":"你好"`, `"title":"`+strings.Repeat("字", 101)+`"`, 1),
		"empty title":  strings.Replace(savedBody, `"title":"你好"`, `"title":" "`, 1),
		"dup ids":      strings.Replace(savedBody, `"id":"m2"`, `"id":"m1"`, 1),
		"bad date":     strings.Replace(savedBody, `2026-10-20T11:00:00.000Z`, `yesterday`, 1),
		"bad role":     strings.Replace(savedBody, `"role":"assistant"`, `"role":"system"`, 1),
		"no messages":  `{"title":"t","modelName":"m","ended":false,"createdAt":"2026-10-20T11:00:00.000Z","messages":[]}`,
		"blank text":   strings.Replace(savedBody, `"text":"你好！"`, `"text":"  "`, 1),
		"long model":   strings.Replace(savedBody, `"modelName":"gpt-test"`, `"modelName":"`+strings.Repeat("m", 151)+`"`, 1),
		"unknown keys": strings.Replace(savedBody, `"ended":false`, `"ended":false,"updatedAt":"x"`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			wantError(t, do(h, "PUT", "/v1/conversations/"+testConversationID, body, jsonAuth), http.StatusBadRequest, "invalid_request")
		})
	}

	if w := do(h, "DELETE", "/v1/conversations/"+testConversationID, "", jsonAuth); w.Code != http.StatusNoContent {
		t.Errorf("delete status %d", w.Code)
	}
	wantError(t, do(h, "DELETE", "/v1/conversations/"+testConversationID, "", jsonAuth), http.StatusNotFound, "not_found")
}
