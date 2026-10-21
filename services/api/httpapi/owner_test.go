package httpapi

import (
	"context"
	"log/slog"
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
	a := &fakeAuth{authenticate: func(_ context.Context, tok string) (auth.Principal, error) {
		if tok != "tok" {
			return auth.Principal{}, auth.ErrUnauthorized
		}
		return auth.Principal{OwnerID: testOwner, Role: role}, nil
	}}
	return NewRouter(Deps{Auth: a, Entries: e, Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: newClock().Now})
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
	_, w, ok := run(auth.RoleMember, "user="+otherOwner)
	if ok {
		t.Fatal("member reading other should fail")
	}
	wantError(t, w, 403, "forbidden")
	if decodeError(t, w).Error.Message != "他の人の記録は管理者だけが見られます。" {
		t.Errorf("message = %q", decodeError(t, w).Error.Message)
	}
	for _, q := range []string{"user=abc", "user=password:short", "user=" + otherOwner + "&user=" + otherOwner, "user=", "user=password:" + strings.Repeat("a", 33)} {
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
	t.Run("writes ignore user", func(t *testing.T) {
		var got string
		h := roleEntriesRouter(t, &fakeEntries{update: func(_ context.Context, o, id string, _ store.EntryPatch) (store.Entry, error) {
			got = o
			return sampleEntry(id, newClock().Now()), nil
		}}, auth.RoleAdmin)
		w := do(h, "PATCH", "/v1/entries/abc?user="+otherOwner, `{"originalText":"a","correctedText":"b","pinyin":"c","hints":[]}`, authHeader)
		if got != testOwner {
			t.Fatalf("code %d, store owner %q, want %q (body %s)", w.Code, got, testOwner, w.Body.String())
		}
	})
}
