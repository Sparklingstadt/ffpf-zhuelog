package httpapi

import (
	"net/http"
	"regexp"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// memberOwnerIDPattern matches a member's owner ID, password or FFPF ID.
var memberOwnerIDPattern = regexp.MustCompile(`^(password|ffpf):[a-z0-9]{1,64}$`)

type memberJSON struct {
	OwnerID     string `json:"ownerId"`
	DisplayName string `json:"displayName"`
	Following   bool   `json:"following"`
	FollowsMe   bool   `json:"followsMe"`
}

func listMembers(f Follows) http.Handler {
	type response struct {
		Members        []memberJSON `json:"members"`
		FollowingCount int          `json:"followingCount"`
		FollowerCount  int          `json:"followerCount"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dir, err := f.ListMembers(r.Context(), principalFrom(r.Context()).OwnerID)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		resp := response{
			Members:        make([]memberJSON, len(dir.Members)),
			FollowingCount: dir.FollowingCount,
			FollowerCount:  dir.FollowerCount,
		}
		for i, m := range dir.Members {
			resp.Members[i] = memberJSON{OwnerID: m.OwnerID, DisplayName: m.DisplayName, Following: m.Following, FollowsMe: m.FollowsMe}
		}
		writeJSON(w, http.StatusOK, resp)
	})
}

// validMemberOwnerID reports whether s is shaped like a member's owner ID.
func validMemberOwnerID(s string) bool { return memberOwnerIDPattern.MatchString(s) }

func followMember(f Follows, now func() time.Time) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target, ok := pathValue(w, r, "ownerId", validMemberOwnerID)
		if !ok {
			return
		}
		self := principalFrom(r.Context()).OwnerID
		if target == self {
			writeError(w, http.StatusBadRequest, codeSelfFollow, msgSelfFollow)
			return
		}
		exists, err := f.MemberExists(r.Context(), target)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		if !exists {
			writeNotFound(w)
			return
		}
		if err := f.Follow(r.Context(), self, target, now()); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func unfollowMember(f Follows) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target, ok := pathValue(w, r, "ownerId", validMemberOwnerID)
		if !ok {
			return
		}
		if err := f.Unfollow(r.Context(), principalFrom(r.Context()).OwnerID, target); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

type timelineItemJSON struct {
	Entry     entryJSON `json:"entry"`
	OwnerID   string    `json:"ownerId"`
	OwnerName string    `json:"ownerName"`
}

func listTimeline(f Follows) http.Handler {
	type response struct {
		Items      []timelineItemJSON `json:"items"`
		NextCursor *string            `json:"nextCursor"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		limit, after, ok := readListQuery(w, r)
		if !ok {
			return
		}
		items, err := f.ListTimeline(r.Context(), principalFrom(r.Context()).OwnerID, after, limit+1)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		items, next := paginate(items, limit, func(it store.TimelineItem) store.Cursor {
			return store.Cursor{CreatedAt: it.Entry.CreatedAt, ID: it.Entry.ID}
		})
		resp := response{NextCursor: next}
		resp.Items = make([]timelineItemJSON, len(items))
		for i, it := range items {
			resp.Items[i] = timelineItemJSON{Entry: toEntryJSON(it.Entry), OwnerID: it.OwnerID, OwnerName: it.OwnerName}
		}
		writeJSON(w, http.StatusOK, resp)
	})
}
