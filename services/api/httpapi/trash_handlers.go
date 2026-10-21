package httpapi

import (
	"net/http"
	"net/url"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type trashedEntryJSON struct {
	entryJSON
	DeletedAt string `json:"deletedAt"`
}

func listTrash(e Entries) http.Handler {
	type response struct {
		Entries    []trashedEntryJSON `json:"entries"`
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
		entries, err := e.ListTrashed(r.Context(), principalFrom(r.Context()).OwnerID, after, limit+1)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		resp := response{}
		if len(entries) > limit {
			entries = entries[:limit]
			last := entries[limit-1]
			c := encodeCursor(store.Cursor{CreatedAt: last.DeletedAt, ID: last.ID})
			resp.NextCursor = &c
		}
		resp.Entries = make([]trashedEntryJSON, len(entries))
		for i, t := range entries {
			resp.Entries[i] = trashedEntryJSON{entryJSON: toEntryJSON(t.Entry), DeletedAt: formatTime(t.DeletedAt)}
		}
		writeJSON(w, http.StatusOK, resp)
	})
}

func restoreEntry(e Entries) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := entryID(w, r)
		if !ok {
			return
		}
		entry, err := e.RestoreEntry(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toEntryJSON(entry))
	})
}

func purgeEntry(e Entries) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := entryID(w, r)
		if !ok {
			return
		}
		if err := e.PurgeEntry(r.Context(), principalFrom(r.Context()).OwnerID, id); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func emptyTrash(e Entries) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n, err := e.EmptyTrash(r.Context(), principalFrom(r.Context()).OwnerID)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"deleted": n})
	})
}

func shareEntry(e Entries, now func() time.Time, shared bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := principalFrom(r.Context())
		if p.Role != auth.RoleMember {
			writeError(w, http.StatusForbidden, "forbidden", msgShareMembersOnly)
			return
		}
		id, ok := entryID(w, r)
		if !ok {
			return
		}
		entry, err := e.SetShared(r.Context(), p.OwnerID, id, shared, now())
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toEntryJSON(entry))
	})
}
