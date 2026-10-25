package httpapi

import (
	"net/http"
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
		Total      int                `json:"total"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		limit, after, ok := readListQuery(w, r)
		if !ok {
			return
		}
		ownerID := principalFrom(r.Context()).OwnerID
		// Count first, as in listEntries.
		total, err := e.CountTrashed(r.Context(), ownerID)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		entries, err := e.ListTrashed(r.Context(), ownerID, after, limit+1)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		entries, next := paginate(entries, limit, func(t store.TrashedEntry) store.Cursor {
			return store.Cursor{CreatedAt: t.DeletedAt, ID: t.ID}
		})
		resp := response{NextCursor: next, Total: total}
		resp.Entries = make([]trashedEntryJSON, len(entries))
		for i, t := range entries {
			resp.Entries[i] = trashedEntryJSON{entryJSON: toEntryJSON(t.Entry), DeletedAt: formatTime(t.DeletedAt)}
		}
		writeJSON(w, http.StatusOK, resp)
	})
}

func restoreEntry(e Entries) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValue(w, r, "id", validID)
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
		id, ok := pathValue(w, r, "id", validID)
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
			writeForbidden(w, msgShareMembersOnly)
			return
		}
		id, ok := pathValue(w, r, "id", validID)
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
