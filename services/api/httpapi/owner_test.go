package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const otherOwner = "password:abcdefghij0123456789"

func roleEntriesRouter(t *testing.T, e Entries, role string) http.Handler {
	t.Helper()
	h, _, _ := routerWith(t, role, Deps{Entries: e})
	return h
}

func TestReadOwner(t *testing.T) {
	run := func(role, query string) (string, *httptest.ResponseRecorder, bool) {
		req := httptest.NewRequest("GET", "/x?"+query, nil)
		req = req.WithContext(context.WithValue(req.Context(), principalKey, auth.Principal{OwnerID: testOwner, Role: role}))
		w := httptest.NewRecorder()
		o, ok := readOwner(w, req)
		return o, w, ok
	}
	for _, q := range []string{"", "user=" + testOwner, "user=password:owner1"} {
		if o, _, ok := run(auth.RoleMember, q); !ok || o != testOwner {
			t.Errorf("member %q: got %q %v", q, o, ok)
		}
	}
	if o, _, ok := run(auth.RoleAdmin, "user="+otherOwner); !ok || o != otherOwner {
		t.Errorf("admin other: %q %v", o, ok)
	}
	if o, _, ok := run(auth.RoleAdmin, "user=12345"); !ok || o != "12345" {
		t.Errorf("admin numeric: %q %v", o, ok)
	}
	if o, _, ok := run(auth.RoleAdmin, "user=ffpf:cabc"); !ok || o != "ffpf:cabc" {
		t.Errorf("admin ffpf: %q %v", o, ok)
	}
	_, w, ok := run(auth.RoleMember, "user="+otherOwner)
	if ok {
		t.Fatal("member reading other should fail")
	}
	wantError(t, w, 403, "forbidden")
	if decodeError(t, w).Error.Message != "他の人の記録は管理者だけが見られます。" {
		t.Errorf("message = %q", decodeError(t, w).Error.Message)
	}
	for _, q := range []string{"user=abc", "user=password:short", "user=" + otherOwner + "&user=" + otherOwner, "user=", "user=password:" + strings.Repeat("a", 33),
		"user=ffpf:", "user=ffpf:ABC", "user=gitlab:1", "user=ffpf:" + strings.Repeat("a", 65)} {
		for _, role := range []string{auth.RoleAdmin, auth.RoleMember} {
			_, w, ok := run(role, q)
			if ok {
				t.Errorf("%s %q should fail", role, q)
				continue
			}
			wantError(t, w, 400, "invalid_request")
		}
	}
}

func TestUserParamRequiresAdmin(t *testing.T) {
	t.Run("member list forbidden without store call", func(t *testing.T) {
		h := roleEntriesRouter(t, &fakeEntries{}, auth.RoleMember)
		wantError(t, do(h, "GET", "/v1/entries?user="+otherOwner, "", authHeader), 403, "forbidden")
		wantError(t, do(h, "GET", "/v1/entries/abc?user="+otherOwner, "", authHeader), 403, "forbidden")
	})
	t.Run("admin list uses the other owner", func(t *testing.T) {
		var got string
		h := roleEntriesRouter(t, &fakeEntries{list: func(_ context.Context, o string, _ *store.Cursor, _ int) ([]store.Entry, error) {
			got = o
			return nil, nil
		}}, auth.RoleAdmin)
		if w := do(h, "GET", "/v1/entries?user="+otherOwner, "", authHeader); w.Code != 200 || got != otherOwner {
			t.Fatalf("code %d owner %q", w.Code, got)
		}
	})
	t.Run("admin get uses the other owner", func(t *testing.T) {
		var got string
		h := roleEntriesRouter(t, &fakeEntries{get: func(_ context.Context, o, id string) (store.Entry, error) {
			got = o
			return sampleEntry(id, newClock().Now()), nil
		}}, auth.RoleAdmin)
		if w := do(h, "GET", "/v1/entries/abc?user="+otherOwner, "", authHeader); w.Code != 200 || got != otherOwner {
			t.Fatalf("code %d owner %q", w.Code, got)
		}
	})
	t.Run("non-read routes reject user", func(t *testing.T) {
		// An empty fakeEntries/fakeFollows fails with 500 if the store is called.
		h, _, _ := routerWith(t, auth.RoleAdmin, Deps{Entries: &fakeEntries{}, Follows: &fakeFollows{}})
		body := `{"originalText":"a","correctedText":"b","pinyin":"c","hints":[]}`
		cases := []struct{ method, path, body string }{
			{"PATCH", "/v1/entries/abc?user=" + otherOwner, body},
			{"DELETE", "/v1/entries/abc?user=" + otherOwner, ""},
			{"POST", "/v1/batches?user=" + otherOwner, `{"entries":[]}`},
			{"PUT", "/v1/entries/abc/share?user=" + otherOwner, ""},
			{"DELETE", "/v1/entries/abc/share?user=" + otherOwner, ""},
			{"GET", "/v1/trash?user=" + otherOwner, ""},
			{"DELETE", "/v1/trash?user=" + otherOwner, ""},
			{"POST", "/v1/trash/abc/restore?user=" + otherOwner, ""},
			{"DELETE", "/v1/trash/abc?user=" + otherOwner, ""},
			{"GET", "/v1/members?user=" + otherOwner, ""},
			{"PUT", "/v1/follows/12345?user=" + otherOwner, ""},
			{"DELETE", "/v1/follows/12345?user=" + otherOwner, ""},
			{"GET", "/v1/timeline?user=" + otherOwner, ""},
			{"GET", "/v1/timeline?user=", ""},
		}
		for _, c := range cases {
			wantError(t, do(h, c.method, c.path, c.body, authHeader), 400, "invalid_request")
		}
		// Unauthenticated callers still get 401 first.
		wantError(t, do(h, "GET", "/v1/timeline?user=x", "", nil), 401, "unauthorized")
	})
}
