package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const actedMember = "password:member2"

// actingAuth authenticates "tok" as role and lets admins act as actedMember.
func actingAuth(role string) *fakeAuth {
	a := tokenAuth(role)
	a.actAs = func(_ context.Context, p auth.Principal, ownerID string) (auth.Principal, error) {
		if ownerID != actedMember {
			return auth.Principal{}, store.ErrNotFound
		}
		return auth.Principal{OwnerID: ownerID, Role: p.Role, Login: p.Login, ActorID: p.OwnerID}, nil
	}
	return a
}

func actAsHeaders(ownerID string) map[string]string {
	return map[string]string{"Authorization": "Bearer tok", actAsHeader: ownerID}
}

func TestActAsWritesGoToTheMember(t *testing.T) {
	var gotOwner string
	h, _, logs := routerWith(t, "", Deps{
		Auth: actingAuth(auth.RoleAdmin),
		Entries: &fakeEntries{emptyTrash: func(_ context.Context, owner string) (int, error) {
			gotOwner = owner
			return 0, nil
		}},
	})
	w := do(h, http.MethodDelete, "/v1/trash", "", actAsHeaders(actedMember))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
	}
	if gotOwner != actedMember {
		t.Fatalf("store owner = %q, want %q", gotOwner, actedMember)
	}
	if !strings.Contains(logs.String(), `"msg":"acting as member"`) ||
		!strings.Contains(logs.String(), `"actor":"`+testOwner+`"`) ||
		!strings.Contains(logs.String(), `"owner":"`+actedMember+`"`) {
		t.Fatalf("no acting log line: %s", logs.String())
	}
}

func TestActAsRejections(t *testing.T) {
	cases := []struct {
		name   string
		role   string
		value  string
		status int
		code   string
	}{
		{"member", auth.RoleMember, actedMember, 403, "forbidden"},
		{"guest on /v1/me", auth.RoleGuest, actedMember, 403, "forbidden"},
		{"empty", auth.RoleAdmin, "", 400, "invalid_request"},
		{"admin owner id", auth.RoleAdmin, "12345", 400, "invalid_request"},
		{"guest owner id", auth.RoleAdmin, "guest", 400, "invalid_request"},
		{"ffpf member owner id", auth.RoleAdmin, "ffpf:cabc", 400, "invalid_request"},
		{"no such member", auth.RoleAdmin, "password:gone", 404, "not_found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := actingAuth(tc.role)
			a.me = func(context.Context, auth.Principal) (auth.Me, error) {
				t.Fatal("handler ran")
				return auth.Me{}, nil
			}
			h, _ := testRouter(t, a, fakePinger{}, nil)
			wantError(t, do(h, http.MethodGet, "/v1/me", "", actAsHeaders(tc.value)), tc.status, tc.code)
		})
	}

	t.Run("two headers", func(t *testing.T) {
		h, _ := testRouter(t, actingAuth(auth.RoleAdmin), fakePinger{}, nil)
		r := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
		r.Header.Set("Authorization", "Bearer tok")
		r.Header.Add(actAsHeader, actedMember)
		r.Header.Add(actAsHeader, actedMember)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		wantError(t, w, 400, "invalid_request")
	})

	t.Run("member is refused on every authed route", func(t *testing.T) {
		d := Deps{Auth: actingAuth(auth.RoleMember), Line: &fakeLine{}, LineChannelSecret: testLineSecret,
			CronSecret: testCronSecret, QuickChat: &fakeChat{}, Questions: &fakeQuestions{}, Chat: &fakeChat{}, Conversations: &fakeConversations{}, PrepositionRecords: &fakePrepositionRecords{}}
		d = d.withDefaults()
		mux, routes := newMux(d)
		h := wrap(d, jsonMuxErrors(mux))
		for _, rt := range routes {
			if !rt.authed {
				continue
			}
			method, path, _ := strings.Cut(rt.pattern, " ")
			path = strings.NewReplacer("{id}", "x", "{ownerId}", "password:x", "{date}", "2026-10-01", "{number}", "1").Replace(path)
			w := do(h, method, path, "", actAsHeaders(actedMember))
			if w.Code != http.StatusForbidden {
				t.Errorf("%s = %d, want 403", rt.pattern, w.Code)
			}
		}
	})
}

func TestMeWhileActing(t *testing.T) {
	a := actingAuth(auth.RoleAdmin)
	var gotP auth.Principal
	a.me = func(_ context.Context, p auth.Principal) (auth.Me, error) {
		gotP = p
		return auth.Me{OwnerID: p.OwnerID, Role: "admin", Login: "alice",
			ActingAs: auth.ActingAs{OwnerID: p.OwnerID, LoginID: "test01", DisplayName: "テスト"}}, nil
	}
	h, _ := testRouter(t, a, fakePinger{}, nil)
	w := do(h, http.MethodGet, "/v1/me", "", actAsHeaders(actedMember))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
	}
	if gotP.OwnerID != actedMember || gotP.ActorID != testOwner || gotP.Role != auth.RoleAdmin {
		t.Fatalf("Me got %+v", gotP)
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	acting, _ := got["actingAs"].(map[string]any)
	if got["ownerId"] != actedMember || acting["ownerId"] != actedMember ||
		acting["loginId"] != "test01" || acting["displayName"] != "テスト" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestLinkRoutesClosedWhileActing(t *testing.T) {
	f := &fakeLine{}
	h, _, _ := routerWith(t, "", Deps{Auth: actingAuth(auth.RoleAdmin), Line: f,
		LineChannelSecret: testLineSecret, CronSecret: testCronSecret})
	for _, rt := range []struct{ method, path string }{
		{"GET", "/v1/line/link"}, {"POST", "/v1/line/link-code"}, {"DELETE", "/v1/line/link"},
	} {
		w := do(h, rt.method, rt.path, "", actAsHeaders(actedMember))
		wantError(t, w, 403, "forbidden")
		if e := decodeError(t, w); e.Error.Message != msgNotWhileActing {
			t.Errorf("%s %s message = %q", rt.method, rt.path, e.Error.Message)
		}
	}
	if f.linkedFor != "" || f.issuedFor.OwnerID != "" || f.unlinkedFor != "" {
		t.Fatalf("LINE service was called: %+v", f)
	}
}
