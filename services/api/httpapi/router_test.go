package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// TestNoRouteAcceptsUserParam walks every registered route and checks that
// every authenticated route rejects ?user= with 400: the web reads other
// members' notes itself, so no Go route may look as if it honoured it.
func TestNoRouteAcceptsUserParam(t *testing.T) {
	a := &fakeAuth{authenticate: func(context.Context, string) (auth.Principal, error) {
		return auth.Principal{OwnerID: testOwner, Role: auth.RoleAdmin}, nil
	}}
	d := Deps{
		Auth: a, Follows: &fakeFollows{},
		Line: &fakeLine{}, LineChannelSecret: testLineSecret, CronSecret: testCronSecret,
		Chat: &fakeChat{}, Conversations: &fakeConversations{},
		AIUsage: &fakeAIUsage{}, Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
	mux, routes := newMux(d)
	h := wrap(d, jsonMuxErrors(mux))

	paths := strings.NewReplacer("{id}", "abc", "{ownerId}", "12345")
	for _, rt := range routes {
		if !rt.authed {
			continue
		}
		method, path, _ := strings.Cut(rt.pattern, " ")
		path = paths.Replace(path)

		// Every authed route requires a token.
		wantError(t, do(h, method, path, "", nil), http.StatusUnauthorized, "unauthorized")

		w := do(h, method, path+"?user="+otherOwner, "", authHeader)
		t.Run(rt.pattern, func(t *testing.T) {
			wantError(t, w, http.StatusBadRequest, "invalid_request")
		})
	}
}

// TestPublicRouteSetIsExactlyTheKnownRoutes pins the routes that are not
// behind requireAuth. Both the route table and real behaviour are checked: a
// request without a token must get 401 on every route except these, so a
// private route registered with public(...) by mistake fails here. The two
// LINE routes are public but check their own credential (a signature, the
// cron secret), so an anonymous request is expected to get 401 from them;
// their credential checks are tested in line_handlers_test.go.
func TestPublicRouteSetIsExactlyTheKnownRoutes(t *testing.T) {
	d := Deps{
		Auth: &fakeAuth{}, Follows: &fakeFollows{},
		Line: &fakeLine{}, LineChannelSecret: testLineSecret, CronSecret: testCronSecret,
		Chat: &fakeChat{}, Conversations: &fakeConversations{},
		DemoReset: &fakeDemoReset{}, Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
	mux, routes := newMux(d)
	h := wrap(d, jsonMuxErrors(mux))

	want := []string{
		"GET /health",
		"GET /healthz",
		"GET /ping",
		"POST /v1/auth/github",
		"POST /v1/auth/ffpf",
		"POST /v1/auth/password",
		"POST /v1/auth/refresh",
		"POST /v1/auth/logout",
		"POST /v1/auth/guest",
		"GET /v1/auth/demo",
		"POST /v1/auth/demo",
		"POST /v1/line/webhook",
		"GET /v1/line/drain",
		"GET /v1/cron/demo-reset",
		"POST /v1/cron/demo-reset",
	}
	selfAuthenticated := map[string]bool{
		"POST /v1/line/webhook": true, "GET /v1/line/drain": true,
		"GET /v1/cron/demo-reset": true, "POST /v1/cron/demo-reset": true,
	}
	isPublic := map[string]bool{}
	for _, p := range want {
		isPublic[p] = true
	}

	paths := strings.NewReplacer("{id}", "abc", "{ownerId}", "12345")
	var got []string
	for _, rt := range routes {
		if !rt.authed {
			got = append(got, rt.pattern)
		}
		method, path, _ := strings.Cut(rt.pattern, " ")
		w := do(h, method, paths.Replace(path), "", nil)
		if selfAuthenticated[rt.pattern] {
			if w.Code != http.StatusUnauthorized {
				t.Errorf("%s: no credential got %d, want 401", rt.pattern, w.Code)
			}
			continue
		}
		if isPublic[rt.pattern] {
			if w.Code == http.StatusUnauthorized {
				t.Errorf("%s: public route answered 401 without a token", rt.pattern)
			}
			continue
		}
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s: no token got %d, want 401 (route is not in the public set)", rt.pattern, w.Code)
		}
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("routes not behind requireAuth\n got: %q\nwant: %q", got, want)
	}
}

// TestRoutesRejectGuests sends a guest token to every authed route that does
// not allow guests and expects 403, and checks that GET /v1/me is the only
// route that does.
func TestRoutesRejectGuests(t *testing.T) {
	a := &fakeAuth{authenticate: func(context.Context, string) (auth.Principal, error) {
		return auth.Principal{OwnerID: auth.GuestOwnerID, Role: auth.RoleGuest}, nil
	}}
	d := Deps{
		Auth: a, Follows: &fakeFollows{},
		Line: &fakeLine{}, LineChannelSecret: testLineSecret, CronSecret: testCronSecret,
		Chat: &fakeChat{}, Conversations: &fakeConversations{},
		Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now,
	}.withDefaults()
	mux, routes := newMux(d)
	h := wrap(d, jsonMuxErrors(mux))

	paths := strings.NewReplacer("{id}", "abc", "{ownerId}", "12345")
	var got []string
	for _, rt := range routes {
		if rt.allowGuest {
			got = append(got, rt.pattern)
		}
		if !rt.authed || rt.allowGuest {
			continue
		}
		method, path, _ := strings.Cut(rt.pattern, " ")
		t.Run(rt.pattern, func(t *testing.T) {
			wantError(t, do(h, method, paths.Replace(path), "", authHeader), http.StatusForbidden, "forbidden")
		})
	}
	if want := []string{"GET /v1/me"}; strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("routes allowing guests\n got: %q\nwant: %q", got, want)
	}
}

// TestSavedNotesReadableWithoutOpenAI builds the router the way main does
// without OPENAI_API_KEY: the conversation store is there, the streamer is
// not. The saved conversations are still served (and one can be deleted);
// sending a message and saving a conversation are not registered.
func TestSavedNotesReadableWithoutOpenAI(t *testing.T) {
	conv := &fakeConversations{saved: map[string]store.Conversation{
		testConversationID: {ConversationSummary: store.ConversationSummary{ID: testConversationID, Title: "t", ModelName: "gpt-old"}},
	}}
	h, _, _ := routerWith(t, auth.RoleMember, Deps{Conversations: conv})

	for _, path := range []string{"/v1/conversations", "/v1/conversations/" + testConversationID} {
		if w := do(h, "GET", path, "", jsonAuth); w.Code != http.StatusOK {
			t.Errorf("GET %s = %d %s, want 200", path, w.Code, w.Body.String())
		}
	}
	// The list reports no chat model, which tells the web the chat is off.
	var body struct {
		ChatModel *string `json:"chatModel"`
	}
	if err := json.Unmarshal(do(h, "GET", "/v1/conversations", "", jsonAuth).Body.Bytes(), &body); err != nil || body.ChatModel == nil || *body.ChatModel != "" {
		t.Errorf("GET /v1/conversations chatModel = %v (%v), want \"\"", body.ChatModel, err)
	}
	if w := do(h, "DELETE", "/v1/conversations/"+testConversationID, "", jsonAuth); w.Code != http.StatusNoContent {
		t.Errorf("DELETE conversation = %d %s, want 204", w.Code, w.Body.String())
	}

	wantError(t, do(h, "POST", "/v1/chat", oneUserMessage, jsonAuth), http.StatusNotFound, "not_found")
	// Saving answers 405: the path exists (GET), the method does not.
	putConv := `{"title":"t","modelName":"m","ended":false,"createdAt":"2026-01-01T00:00:00Z","messages":[]}`
	wantError(t, do(h, "PUT", "/v1/conversations/"+testConversationID, putConv, jsonAuth), http.StatusMethodNotAllowed, "method_not_allowed")
}
