package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type fakeFollows struct {
	listMembers  func(ctx context.Context, viewerID string) (store.MemberDirectory, error)
	memberExists func(ctx context.Context, ownerID string) (bool, error)
	follow       func(ctx context.Context, followerID, followeeID string, now time.Time) error
	unfollow     func(ctx context.Context, followerID, followeeID string) error
	listTimeline func(ctx context.Context, viewerID string, after *store.Cursor, limit int) ([]store.TimelineItem, error)
}

func (f *fakeFollows) ListMembers(ctx context.Context, viewerID string) (store.MemberDirectory, error) {
	if f.listMembers == nil {
		return store.MemberDirectory{}, errUnexpectedCall{"ListMembers"}
	}
	return f.listMembers(ctx, viewerID)
}

func (f *fakeFollows) MemberExists(ctx context.Context, ownerID string) (bool, error) {
	if f.memberExists == nil {
		return false, errUnexpectedCall{"MemberExists"}
	}
	return f.memberExists(ctx, ownerID)
}

func (f *fakeFollows) Follow(ctx context.Context, followerID, followeeID string, now time.Time) error {
	if f.follow == nil {
		return errUnexpectedCall{"Follow"}
	}
	return f.follow(ctx, followerID, followeeID, now)
}

func (f *fakeFollows) Unfollow(ctx context.Context, followerID, followeeID string) error {
	if f.unfollow == nil {
		return errUnexpectedCall{"Unfollow"}
	}
	return f.unfollow(ctx, followerID, followeeID)
}

func (f *fakeFollows) ListTimeline(ctx context.Context, viewerID string, after *store.Cursor, limit int) ([]store.TimelineItem, error) {
	if f.listTimeline == nil {
		return nil, errUnexpectedCall{"ListTimeline"}
	}
	return f.listTimeline(ctx, viewerID, after, limit)
}

func followsRouter(t *testing.T, f Follows, role string) (http.Handler, *clock) {
	t.Helper()
	c := newClock()
	a := &fakeAuth{authenticate: func(_ context.Context, tok string) (auth.Principal, error) {
		if tok != "tok" {
			return auth.Principal{}, auth.ErrUnauthorized
		}
		return auth.Principal{OwnerID: testOwner, Role: role}, nil
	}}
	return NewRouter(Deps{Auth: a, Follows: f, Logger: slog.New(slog.NewJSONHandler(&strings.Builder{}, nil)), Now: c.Now}), c
}

func TestAllFollowRoutesRequireAuth(t *testing.T) {
	h, _ := followsRouter(t, &fakeFollows{}, auth.RoleMember)
	for _, rt := range []struct{ method, target string }{
		{http.MethodGet, "/v1/members"},
		{http.MethodPut, "/v1/follows/password:x"},
		{http.MethodDelete, "/v1/follows/password:x"},
		{http.MethodGet, "/v1/timeline"},
	} {
		t.Run(rt.method+" "+rt.target, func(t *testing.T) {
			wantError(t, do(h, rt.method, rt.target, "", nil), http.StatusUnauthorized, "unauthorized")
		})
	}
}

func TestMembersHandler(t *testing.T) {
	names := []string{"さくら", "あおい", "Bob", "あおい"}
	members := make([]store.Member, len(names))
	for i, n := range names {
		members[i] = store.Member{OwnerID: "password:m" + strconv.Itoa(i), DisplayName: n, Following: i == 0, FollowsMe: i == 1}
	}
	for _, role := range []string{auth.RoleMember, auth.RoleAdmin} {
		t.Run(role, func(t *testing.T) {
			var gotViewer string
			h, _ := followsRouter(t, &fakeFollows{listMembers: func(_ context.Context, v string) (store.MemberDirectory, error) {
				gotViewer = v
				return store.MemberDirectory{Members: members, FollowingCount: 1, FollowerCount: 7}, nil
			}}, role)
			w := do(h, http.MethodGet, "/v1/members", "", authHeader)
			if w.Code != http.StatusOK || gotViewer != testOwner {
				t.Fatalf("status=%d viewer=%q body=%s", w.Code, gotViewer, w.Body.String())
			}
			var resp struct {
				Members []struct {
					OwnerID     string `json:"ownerId"`
					DisplayName string `json:"displayName"`
					Following   bool   `json:"following"`
					FollowsMe   bool   `json:"followsMe"`
				} `json:"members"`
				FollowingCount int `json:"followingCount"`
				FollowerCount  int `json:"followerCount"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatal(err)
			}
			if resp.FollowingCount != 1 || resp.FollowerCount != 7 {
				t.Fatalf("counts = %d/%d", resp.FollowingCount, resp.FollowerCount)
			}
			sorted := members // the handler must keep the store's order
			if len(resp.Members) != len(sorted) {
				t.Fatalf("members = %d", len(resp.Members))
			}
			for i, m := range sorted {
				g := resp.Members[i]
				if g.OwnerID != m.OwnerID || g.DisplayName != m.DisplayName || g.Following != m.Following || g.FollowsMe != m.FollowsMe {
					t.Fatalf("member %d = %+v, want %+v", i, g, m)
				}
			}
			// The directory is visible to every member, so it must not reveal
			// sign-in identifiers.
			var raw struct {
				Members []map[string]any `json:"members"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
				t.Fatal(err)
			}
			for i, m := range raw.Members {
				keys := slices.Sorted(maps.Keys(m))
				if want := []string{"displayName", "following", "followsMe", "ownerId"}; !slices.Equal(keys, want) {
					t.Fatalf("member %d keys = %v, want %v", i, keys, want)
				}
			}
		})
	}

	t.Run("empty list is an array", func(t *testing.T) {
		h, _ := followsRouter(t, &fakeFollows{listMembers: func(context.Context, string) (store.MemberDirectory, error) {
			return store.MemberDirectory{}, nil
		}}, auth.RoleMember)
		w := do(h, http.MethodGet, "/v1/members", "", authHeader)
		if !strings.Contains(w.Body.String(), `"members":[]`) {
			t.Fatalf("body = %s", w.Body.String())
		}
	})
}

func TestFollowHandler(t *testing.T) {
	t.Run("existing member gets 204 and Follow", func(t *testing.T) {
		var gotFollower, gotFollowee string
		var gotNow time.Time
		h, c := followsRouter(t, &fakeFollows{
			memberExists: func(_ context.Context, id string) (bool, error) { return id == "password:other", nil },
			follow: func(_ context.Context, a, b string, now time.Time) error {
				gotFollower, gotFollowee, gotNow = a, b, now
				return nil
			},
		}, auth.RoleAdmin)
		w := do(h, http.MethodPut, "/v1/follows/password:other", "", authHeader)
		if w.Code != http.StatusNoContent || gotFollower != testOwner || gotFollowee != "password:other" || !gotNow.Equal(c.Now()) {
			t.Fatalf("status=%d follower=%q followee=%q now=%v", w.Code, gotFollower, gotFollowee, gotNow)
		}
	})
	t.Run("unknown member is 404", func(t *testing.T) {
		h, _ := followsRouter(t, &fakeFollows{memberExists: func(context.Context, string) (bool, error) { return false, nil }}, auth.RoleMember)
		wantError(t, do(h, http.MethodPut, "/v1/follows/password:ghost", "", authHeader), http.StatusNotFound, "not_found")
	})
	t.Run("self is 400 without store calls", func(t *testing.T) {
		h, _ := followsRouter(t, &fakeFollows{}, auth.RoleMember)
		w := do(h, http.MethodPut, "/v1/follows/"+testOwner, "", authHeader)
		wantError(t, w, http.StatusBadRequest, "self_follow")
		if e := decodeError(t, w); e.Error.Message != "自分はフォローできません。" {
			t.Fatalf("message = %q", e.Error.Message)
		}
	})
	t.Run("store error is 500", func(t *testing.T) {
		h, _ := followsRouter(t, &fakeFollows{}, auth.RoleMember)
		wantError(t, do(h, http.MethodPut, "/v1/follows/password:other", "", authHeader), http.StatusInternalServerError, "internal")
	})
}

func TestUnfollowHandler(t *testing.T) {
	var gotA, gotB string
	h, _ := followsRouter(t, &fakeFollows{unfollow: func(_ context.Context, a, b string) error {
		gotA, gotB = a, b
		return nil
	}}, auth.RoleMember)
	w := do(h, http.MethodDelete, "/v1/follows/password:other", "", authHeader)
	if w.Code != http.StatusNoContent || gotA != testOwner || gotB != "password:other" {
		t.Fatalf("status=%d %q %q", w.Code, gotA, gotB)
	}
	if w := do(h, http.MethodDelete, "/v1/follows/"+testOwner, "", authHeader); w.Code != http.StatusNoContent {
		t.Fatalf("self unfollow = %d", w.Code)
	}
}

func TestFollowRejectsBadOwnerID(t *testing.T) {
	h, _ := followsRouter(t, &fakeFollows{}, auth.RoleMember)
	for _, id := range []string{"12345", "password:", "password:ABC", "password:" + strings.Repeat("a", 65)} {
		for _, m := range []string{http.MethodPut, http.MethodDelete} {
			t.Run(m+" "+id, func(t *testing.T) {
				wantError(t, do(h, m, "/v1/follows/"+id, "", authHeader), http.StatusNotFound, "not_found")
			})
		}
	}
}

func TestTimelineHandler(t *testing.T) {
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	mk := func(n int) []store.TimelineItem {
		out := make([]store.TimelineItem, n)
		for i := range out {
			out[i] = store.TimelineItem{
				Entry:     sampleEntry("e"+strconv.Itoa(i), base.Add(-time.Duration(i)*time.Minute)),
				OwnerID:   "password:o" + strconv.Itoa(i),
				OwnerName: "名前" + strconv.Itoa(i),
			}
		}
		return out
	}

	t.Run("default limit and shape", func(t *testing.T) {
		var gotLimit int
		var gotViewer string
		h, _ := followsRouter(t, &fakeFollows{listTimeline: func(_ context.Context, v string, _ *store.Cursor, limit int) ([]store.TimelineItem, error) {
			gotViewer, gotLimit = v, limit
			return mk(2), nil
		}}, auth.RoleAdmin)
		w := do(h, http.MethodGet, "/v1/timeline", "", authHeader)
		if w.Code != http.StatusOK || gotLimit != 51 || gotViewer != testOwner {
			t.Fatalf("status=%d limit=%d viewer=%q", w.Code, gotLimit, gotViewer)
		}
		var resp struct {
			Items []struct {
				Entry     entryView `json:"entry"`
				OwnerID   string    `json:"ownerId"`
				OwnerName string    `json:"ownerName"`
			} `json:"items"`
			NextCursor *string `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Items) != 2 || resp.NextCursor != nil || resp.Items[0].Entry.ID != "e0" ||
			resp.Items[1].OwnerID != "password:o1" || resp.Items[1].OwnerName != "名前1" {
			t.Fatalf("got %s", w.Body.String())
		}
	})

	t.Run("empty items is an array", func(t *testing.T) {
		h, _ := followsRouter(t, &fakeFollows{listTimeline: func(context.Context, string, *store.Cursor, int) ([]store.TimelineItem, error) {
			return nil, nil
		}}, auth.RoleMember)
		w := do(h, http.MethodGet, "/v1/timeline", "", authHeader)
		if !strings.Contains(w.Body.String(), `"items":[]`) || !strings.Contains(w.Body.String(), `"nextCursor":null`) {
			t.Fatalf("body = %s", w.Body.String())
		}
	})

	t.Run("limit+1 produces a cursor on (entry createdAt, id)", func(t *testing.T) {
		h, _ := followsRouter(t, &fakeFollows{listTimeline: func(_ context.Context, _ string, _ *store.Cursor, limit int) ([]store.TimelineItem, error) {
			if limit != 3 {
				t.Errorf("limit = %d", limit)
			}
			return mk(3), nil
		}}, auth.RoleMember)
		w := do(h, http.MethodGet, "/v1/timeline?limit=2", "", authHeader)
		var resp struct {
			Items      []json.RawMessage `json:"items"`
			NextCursor *string           `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		want := encodeCursor(store.Cursor{CreatedAt: base.Add(-time.Minute), ID: "e1"})
		if len(resp.Items) != 2 || resp.NextCursor == nil || *resp.NextCursor != want {
			t.Fatalf("items=%d cursor=%v want %q", len(resp.Items), resp.NextCursor, want)
		}
	})

	t.Run("cursor is passed to the store", func(t *testing.T) {
		c := store.Cursor{CreatedAt: base, ID: "e9"}
		var got *store.Cursor
		h, _ := followsRouter(t, &fakeFollows{listTimeline: func(_ context.Context, _ string, after *store.Cursor, _ int) ([]store.TimelineItem, error) {
			got = after
			return nil, nil
		}}, auth.RoleMember)
		w := do(h, http.MethodGet, "/v1/timeline?cursor="+encodeCursor(c), "", authHeader)
		if w.Code != http.StatusOK || got == nil || got.ID != "e9" || !got.CreatedAt.Equal(base) {
			t.Fatalf("status=%d cursor=%+v", w.Code, got)
		}
	})

	t.Run("bad queries are 400 without store calls", func(t *testing.T) {
		h, _ := followsRouter(t, &fakeFollows{}, auth.RoleMember)
		for _, q := range []string{"?limit=0", "?limit=101", "?limit=abc", "?limit=1&limit=2", "?cursor=!!!"} {
			wantError(t, do(h, http.MethodGet, "/v1/timeline"+q, "", authHeader), http.StatusBadRequest, "invalid_request")
		}
	})
}
