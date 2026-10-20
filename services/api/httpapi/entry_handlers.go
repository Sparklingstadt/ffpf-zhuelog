package httpapi

import (
	"net/http"
	"net/url"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	defaultListLimit = 50
	maxListLimit     = 100
	timeLayout       = "2006-01-02T15:04:05.000Z07:00"
)

type hintJSON struct {
	ID       string `json:"id"`
	Content  string `json:"content"`
	Position int    `json:"position"`
}

type entryJSON struct {
	ID            string     `json:"id"`
	Kind          string     `json:"kind"`
	OriginalText  string     `json:"originalText"`
	CorrectedText string     `json:"correctedText"`
	Pinyin        string     `json:"pinyin"`
	Hints         []hintJSON `json:"hints"`
	CreatedAt     string     `json:"createdAt"`
	SharedAt      *string    `json:"sharedAt"`
}

func formatTime(t time.Time) string { return t.UTC().Format(timeLayout) }

func toEntryJSON(e store.Entry) entryJSON {
	out := entryJSON{
		ID:            e.ID,
		Kind:          e.Kind,
		OriginalText:  e.OriginalText,
		CorrectedText: e.CorrectedText,
		Pinyin:        e.Pinyin,
		Hints:         make([]hintJSON, len(e.Hints)),
		CreatedAt:     formatTime(e.CreatedAt),
	}
	for i, h := range e.Hints {
		out.Hints[i] = hintJSON{ID: h.ID, Content: h.Content, Position: h.Position}
	}
	if e.SharedAt != nil {
		s := formatTime(*e.SharedAt)
		out.SharedAt = &s
	}
	return out
}

func toEntriesJSON(entries []store.Entry) []entryJSON {
	out := make([]entryJSON, len(entries))
	for i, e := range entries {
		out[i] = toEntryJSON(e)
	}
	return out
}

func writeBadRequest(w http.ResponseWriter) {
	writeError(w, http.StatusBadRequest, "invalid_request", msgBadRequest)
}

// parseListQuery reads limit and cursor from the query string.
func parseListQuery(q url.Values) (int, *store.Cursor, bool) {
	limit := defaultListLimit
	if vals, ok := q["limit"]; ok {
		if len(vals) != 1 || !isDecimal(vals[0]) {
			return 0, nil, false
		}
		n := 0
		for _, c := range vals[0] {
			n = n*10 + int(c-'0')
			if n > maxListLimit {
				return 0, nil, false
			}
		}
		if n < 1 {
			return 0, nil, false
		}
		limit = n
	}
	var after *store.Cursor
	if vals := q["cursor"]; len(vals) > 1 {
		return 0, nil, false
	} else if len(vals) == 1 && vals[0] != "" {
		c, err := decodeCursor(vals[0])
		if err != nil {
			return 0, nil, false
		}
		after = &c
	}
	return limit, after, true
}

func isDecimal(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func listEntries(e Entries) http.Handler {
	type response struct {
		Entries    []entryJSON `json:"entries"`
		NextCursor *string     `json:"nextCursor"`
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
		entries, err := e.ListEntries(r.Context(), principalFrom(r.Context()).OwnerID, after, limit+1)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		resp := response{}
		if len(entries) > limit {
			entries = entries[:limit]
			last := entries[limit-1]
			c := encodeCursor(store.Cursor{CreatedAt: last.CreatedAt, ID: last.ID})
			resp.NextCursor = &c
		}
		resp.Entries = toEntriesJSON(entries)
		writeJSON(w, http.StatusOK, resp)
	})
}

// entryID returns the {id} path value, answering 404 itself when it cannot be
// the ID of any row.
func entryID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusNotFound, "not_found", msgNotFound)
		return "", false
	}
	return id, true
}

func getEntry(e Entries) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := entryID(w, r)
		if !ok {
			return
		}
		entry, err := e.GetEntry(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toEntryJSON(entry))
	})
}

func createBatch(e Entries, now func() time.Time) http.Handler {
	type request struct {
		Entries []entryBody `json:"entries"`
	}
	type batchJSON struct {
		ID         string `json:"id"`
		ImportedAt string `json:"importedAt"`
	}
	type response struct {
		Batch   batchJSON   `json:"batch"`
		Entries []entryJSON `json:"entries"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		if len(req.Entries) < 1 || len(req.Entries) > maxBatchEntries {
			writeBadRequest(w)
			return
		}
		drafts := make([]store.EntryDraft, len(req.Entries))
		for i, b := range req.Entries {
			d, err := validateDraft(b.draftInput())
			if err != nil {
				writeBadRequest(w)
				return
			}
			drafts[i] = d
		}
		batch, entries, err := e.CreateBatch(r.Context(), principalFrom(r.Context()).OwnerID, drafts, now())
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, response{
			Batch:   batchJSON{ID: batch.ID, ImportedAt: formatTime(batch.ImportedAt)},
			Entries: toEntriesJSON(entries),
		})
	})
}

func patchEntry(e Entries) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := entryID(w, r)
		if !ok {
			return
		}
		var body entryBody
		if err := decodeBody(r, &body); err != nil {
			writeBodyError(w, r, err)
			return
		}
		patch, err := validatePatch(body.patchInput())
		if err != nil {
			writeBadRequest(w)
			return
		}
		entry, err := e.UpdateEntry(r.Context(), principalFrom(r.Context()).OwnerID, id, patch)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toEntryJSON(entry))
	})
}

func deleteEntry(e Entries, now func() time.Time) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := entryID(w, r)
		if !ok {
			return
		}
		if err := e.TrashEntry(r.Context(), principalFrom(r.Context()).OwnerID, id, now()); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
