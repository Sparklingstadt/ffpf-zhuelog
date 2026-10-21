package httpapi

import (
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

var memberOwnerIDPattern = regexp.MustCompile(`^password:[a-z0-9]{1,64}$`)

type memberJSON struct {
	OwnerID     string `json:"ownerId"`
	DisplayName string `json:"displayName"`
	LoginID     string `json:"loginId"`
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
			resp.Members[i] = memberJSON{OwnerID: m.OwnerID, DisplayName: m.DisplayName, LoginID: m.LoginID, Following: m.Following, FollowsMe: m.FollowsMe}
		}
		writeJSON(w, http.StatusOK, resp)
	})
}

// followTarget returns the {ownerId} path value, or writes a 404 when it is
// not shaped like a member id.
func followTarget(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("ownerId")
	if !memberOwnerIDPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "not_found", msgNotFound)
		return "", false
	}
	return id, true
}

func followMember(f Follows, now func() time.Time) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target, ok := followTarget(w, r)
		if !ok {
			return
		}
		self := principalFrom(r.Context()).OwnerID
		if target == self {
			writeError(w, http.StatusBadRequest, "self_follow", msgSelfFollow)
			return
		}
		exists, err := f.MemberExists(r.Context(), target)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		if !exists {
			writeError(w, http.StatusNotFound, "not_found", msgNotFound)
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
		target, ok := followTarget(w, r)
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
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			writeBadRequest(w)
			return
		}
		limit, after, ok := parseListQuery(q)
		if !ok {
			writeBadRequest(w)
			return
		}
		items, err := f.ListTimeline(r.Context(), principalFrom(r.Context()).OwnerID, after, limit+1)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		resp := response{}
		if len(items) > limit {
			items = items[:limit]
			last := items[limit-1].Entry
			c := encodeCursor(store.Cursor{CreatedAt: last.CreatedAt, ID: last.ID})
			resp.NextCursor = &c
		}
		resp.Items = make([]timelineItemJSON, len(items))
		for i, it := range items {
			resp.Items[i] = timelineItemJSON{Entry: toEntryJSON(it.Entry), OwnerID: it.OwnerID, OwnerName: it.OwnerName}
		}
		writeJSON(w, http.StatusOK, resp)
	})
}
