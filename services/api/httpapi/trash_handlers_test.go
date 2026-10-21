package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

func roleRouter(t *testing.T, e Entries, role string) (http.Handler, *clock) {
	t.Helper()
	c := newClock()
	a := &fakeAuth{authenticate: func(_ context.Context, tok string) (auth.Principal, error) {
		if tok != "tok" {
			return auth.Principal{}, auth.ErrUnauthorized
		}
		return auth.Principal{OwnerID: testOwner, Role: role}, nil
	}}
	return NewRouter(Deps{Auth: a, Entries: e, Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: c.Now}), c
}

func TestAllTrashRoutesRequireAuth(t *testing.T) {
	h, _ := roleRouter(t, &fakeEntries{}, auth.RoleMember)
	routes := []struct{ method, target string }{
		{http.MethodGet, "/v1/trash"},
		{http.MethodDelete, "/v1/trash"},
		{http.MethodPost, "/v1/trash/x/restore"},
		{http.MethodDelete, "/v1/trash/x"},
		{http.MethodPut, "/v1/entries/x/share"},
		{http.MethodDelete, "/v1/entries/x/share"},
	}
	for _, rt := range routes {
		t.Run(rt.method+" "+rt.target, func(t *testing.T) {
			wantError(t, do(h, rt.method, rt.target, "", nil), http.StatusUnauthorized, "unauthorized")
		})
	}
}

func TestInvalidIDSkipsStore(t *testing.T) {
	h, _ := roleRouter(t, &fakeEntries{}, auth.RoleMember)
	bad := "a%00b" // NUL is never a valid ID
	for _, rt := range []struct{ method, target string }{
		{http.MethodPost, "/v1/trash/" + bad + "/restore"},
		{http.MethodDelete, "/v1/trash/" + bad},
		{http.MethodPut, "/v1/entries/" + bad + "/share"},
		{http.MethodDelete, "/v1/entries/" + bad + "/share"},
	} {
		t.Run(rt.method+" "+rt.target, func(t *testing.T) {
			wantError(t, do(h, rt.method, rt.target, "", authHeader), http.StatusNotFound, "not_found")
		})
	}
}

func TestListTrashHandler(t *testing.T) {
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	mk := func(n int) []store.TrashedEntry {
		out := make([]store.TrashedEntry, n)
		for i := range out {
			out[i] = store.TrashedEntry{
				Entry:     sampleEntry("e"+strconv.Itoa(i), base.Add(-time.Hour)),
				DeletedAt: base.Add(-time.Duration(i) * time.Minute),
			}
		}
		return out
	}

	t.Run("default limit asks for 51 and has no cursor when short", func(t *testing.T) {
		var gotLimit int
		var gotOwner string
		h, _ := roleRouter(t, &fakeEntries{listTrashed: func(_ context.Context, owner string, _ *store.Cursor, limit int) ([]store.TrashedEntry, error) {
			gotOwner, gotLimit = owner, limit
			return mk(2), nil
		}}, auth.RoleMember)
		w := do(h, http.MethodGet, "/v1/trash", "", authHeader)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		if gotLimit != 51 || gotOwner != testOwner {
			t.Fatalf("limit=%d owner=%q", gotLimit, gotOwner)
		}
		var resp struct {
			Entries []struct {
				entryView
				DeletedAt string `json:"deletedAt"`
			} `json:"entries"`
			NextCursor *string `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 2 || resp.NextCursor != nil {
			t.Fatalf("entries=%d cursor=%v", len(resp.Entries), resp.NextCursor)
		}
		if resp.Entries[0].DeletedAt != "2026-10-01T00:00:00.000Z" || resp.Entries[0].ID != "e0" {
			t.Fatalf("got %+v", resp.Entries[0])
		}
	})

	t.Run("limit+1 rows produce a cursor on (deletedAt, id)", func(t *testing.T) {
		h, _ := roleRouter(t, &fakeEntries{listTrashed: func(_ context.Context, _ string, _ *store.Cursor, limit int) ([]store.TrashedEntry, error) {
			if limit != 3 {
				t.Errorf("limit = %d, want 3", limit)
			}
			return mk(3), nil
		}}, auth.RoleMember)
		w := do(h, http.MethodGet, "/v1/trash?limit=2", "", authHeader)
		var resp struct {
			Entries    []json.RawMessage `json:"entries"`
			NextCursor *string           `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 2 || resp.NextCursor == nil {
			t.Fatalf("entries=%d cursor=%v", len(resp.Entries), resp.NextCursor)
		}
		want := encodeCursor(store.Cursor{CreatedAt: base.Add(-time.Minute), ID: "e1"})
		if *resp.NextCursor != want {
			t.Fatalf("cursor = %q, want %q", *resp.NextCursor, want)
		}
	})

	t.Run("cursor is passed to the store", func(t *testing.T) {
		c := store.Cursor{CreatedAt: base, ID: "e9"}
		var got *store.Cursor
		h, _ := roleRouter(t, &fakeEntries{listTrashed: func(_ context.Context, _ string, after *store.Cursor, _ int) ([]store.TrashedEntry, error) {
			got = after
			return nil, nil
		}}, auth.RoleMember)
		w := do(h, http.MethodGet, "/v1/trash?cursor="+encodeCursor(c), "", authHeader)
		if w.Code != http.StatusOK || got == nil || got.ID != "e9" || !got.CreatedAt.Equal(base) {
			t.Fatalf("status=%d cursor=%+v", w.Code, got)
		}
		if !strings.Contains(w.Body.String(), `"entries":[]`) {
			t.Fatalf("body = %s", w.Body.String())
		}
	})

	t.Run("store error", func(t *testing.T) {
		h, _ := roleRouter(t, &fakeEntries{listTrashed: func(context.Context, string, *store.Cursor, int) ([]store.TrashedEntry, error) {
			return nil, errors.New("boom")
		}}, auth.RoleMember)
		wantError(t, do(h, http.MethodGet, "/v1/trash", "", authHeader), http.StatusInternalServerError, "internal")
	})
}

func TestListTrashBadQuery(t *testing.T) {
	h, _ := roleRouter(t, &fakeEntries{}, auth.RoleMember)
	for _, q := range []string{"limit=0", "limit=101", "limit=abc", "cursor=!!!"} {
		t.Run(q, func(t *testing.T) {
			wantError(t, do(h, http.MethodGet, "/v1/trash?"+q, "", authHeader), http.StatusBadRequest, "invalid_request")
		})
	}
}

func TestRestoreHandler(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		var gotID string
		h, _ := roleRouter(t, &fakeEntries{restore: func(_ context.Context, owner, id string) (store.Entry, error) {
			gotID = id
			if owner != testOwner {
				t.Errorf("owner = %q", owner)
			}
			return sampleEntry(id, time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)), nil
		}}, auth.RoleMember)
		w := do(h, http.MethodPost, "/v1/trash/abc/restore", "", authHeader)
		if w.Code != http.StatusOK || gotID != "abc" {
			t.Fatalf("status=%d id=%q body=%s", w.Code, gotID, w.Body.String())
		}
		var v entryView
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil || v.ID != "abc" {
			t.Fatalf("body = %s (%v)", w.Body.String(), err)
		}
	})
	t.Run("not found", func(t *testing.T) {
		h, _ := roleRouter(t, &fakeEntries{restore: func(context.Context, string, string) (store.Entry, error) {
			return store.Entry{}, store.ErrNotFound
		}}, auth.RoleMember)
		wantError(t, do(h, http.MethodPost, "/v1/trash/abc/restore", "", authHeader), http.StatusNotFound, "not_found")
	})
}

func TestPurgeHandler(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		var gotID string
		h, _ := roleRouter(t, &fakeEntries{purge: func(_ context.Context, _, id string) error {
			gotID = id
			return nil
		}}, auth.RoleMember)
		w := do(h, http.MethodDelete, "/v1/trash/abc", "", authHeader)
		if w.Code != http.StatusNoContent || gotID != "abc" || w.Body.Len() != 0 {
			t.Fatalf("status=%d id=%q body=%q", w.Code, gotID, w.Body.String())
		}
	})
	t.Run("not found", func(t *testing.T) {
		h, _ := roleRouter(t, &fakeEntries{purge: func(context.Context, string, string) error { return store.ErrNotFound }}, auth.RoleMember)
		wantError(t, do(h, http.MethodDelete, "/v1/trash/abc", "", authHeader), http.StatusNotFound, "not_found")
	})
}

func TestEmptyTrashHandler(t *testing.T) {
	h, _ := roleRouter(t, &fakeEntries{emptyTrash: func(_ context.Context, owner string) (int, error) {
		if owner != testOwner {
			t.Errorf("owner = %q", owner)
		}
		return 3, nil
	}}, auth.RoleMember)
	w := do(h, http.MethodDelete, "/v1/trash", "", authHeader)
	if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != `{"deleted":3}` {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestShareHandler(t *testing.T) {
	for _, tc := range []struct {
		method string
		want   bool
	}{{http.MethodPut, true}, {http.MethodDelete, false}} {
		t.Run(tc.method, func(t *testing.T) {
			var gotShared bool
			var gotNow time.Time
			var gotID string
			h, c := roleRouter(t, &fakeEntries{setShared: func(_ context.Context, owner, id string, shared bool, now time.Time) (store.Entry, error) {
				gotShared, gotNow, gotID = shared, now, id
				if owner != testOwner {
					t.Errorf("owner = %q", owner)
				}
				return sampleEntry(id, now), nil
			}}, auth.RoleMember)
			w := do(h, tc.method, "/v1/entries/abc/share", "", authHeader)
			if w.Code != http.StatusOK || gotShared != tc.want || gotID != "abc" || !gotNow.Equal(c.Now()) {
				t.Fatalf("status=%d shared=%v id=%q now=%v body=%s", w.Code, gotShared, gotID, gotNow, w.Body.String())
			}
			var v entryView
			if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil || v.ID != "abc" {
				t.Fatalf("body = %s (%v)", w.Body.String(), err)
			}
		})
	}
	t.Run("not found", func(t *testing.T) {
		h, _ := roleRouter(t, &fakeEntries{setShared: func(context.Context, string, string, bool, time.Time) (store.Entry, error) {
			return store.Entry{}, store.ErrNotFound
		}}, auth.RoleMember)
		wantError(t, do(h, http.MethodPut, "/v1/entries/abc/share", "", authHeader), http.StatusNotFound, "not_found")
	})
}

func TestShareRequiresMember(t *testing.T) {
	h, _ := roleRouter(t, &fakeEntries{}, auth.RoleAdmin) // unset hook would give 500
	for _, m := range []string{http.MethodPut, http.MethodDelete} {
		t.Run(m, func(t *testing.T) {
			w := do(h, m, "/v1/entries/abc/share", "", authHeader)
			wantError(t, w, http.StatusForbidden, "forbidden")
			if got := decodeError(t, w).Error.Message; got != "共有できるのは会員だけです。" {
				t.Fatalf("message = %q", got)
			}
		})
	}
}
