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

// batchJSON is the batch object in the create-batch and CSV-import responses.
type batchJSON struct {
	ID         string `json:"id"`
	ImportedAt string `json:"importedAt"`
}

func toBatchJSON(b store.Batch) batchJSON {
	return batchJSON{ID: b.ID, ImportedAt: formatTime(b.ImportedAt)}
}

func toEntriesJSON(entries []store.Entry) []entryJSON {
	out := make([]entryJSON, len(entries))
	for i, e := range entries {
		out[i] = toEntryJSON(e)
	}
	return out
}

// decimalUpTo parses s as base-10 digits only (leading zeros allowed, so the
// caller rejects them if it must) and reports false when it is empty,
// contains anything else, or exceeds max.
func decimalUpTo(s string, max int) (int, bool) {
	if s == "" {
		return 0, false
	}
	n := 0
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
		n = n*10 + int(s[i]-'0')
		if n > max {
			return 0, false
		}
	}
	return n, true
}

// readListQuery reads limit (1..100, default 50) and cursor from the query
// string. On failure it has already written the 400 and returns false.
func readListQuery(w http.ResponseWriter, r *http.Request) (int, *store.Cursor, bool) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writeBadRequest(w)
		return 0, nil, false
	}
	limit := defaultListLimit
	if vals, ok := q["limit"]; ok {
		n, valid := 0, len(vals) == 1
		if valid {
			n, valid = decimalUpTo(vals[0], maxListLimit)
		}
		if !valid || n < 1 {
			writeBadRequest(w)
			return 0, nil, false
		}
		limit = n
	}
	var after *store.Cursor
	if vals := q["cursor"]; len(vals) > 1 {
		writeBadRequest(w)
		return 0, nil, false
	} else if len(vals) == 1 && vals[0] != "" {
		c, err := decodeCursor(vals[0])
		if err != nil {
			writeBadRequest(w)
			return 0, nil, false
		}
		after = &c
	}
	return limit, after, true
}

// paginate trims a page fetched with limit+1 rows to limit and, when a row was
// trimmed, returns the cursor for the next page built from the last kept row.
func paginate[T any](items []T, limit int, key func(T) store.Cursor) ([]T, *string) {
	if len(items) <= limit {
		return items, nil
	}
	items = items[:limit]
	c := encodeCursor(key(items[limit-1]))
	return items, &c
}

func listEntries(e Entries) http.Handler {
	type response struct {
		Entries    []entryJSON `json:"entries"`
		NextCursor *string     `json:"nextCursor"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		limit, after, ok := readListQuery(w, r)
		if !ok {
			return
		}
		owner, ok := readOwner(w, r)
		if !ok {
			return
		}
		entries, err := e.ListEntries(r.Context(), owner, after, limit+1)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		entries, next := paginate(entries, limit, func(e store.Entry) store.Cursor {
			return store.Cursor{CreatedAt: e.CreatedAt, ID: e.ID}
		})
		resp := response{Entries: toEntriesJSON(entries), NextCursor: next}
		writeJSON(w, http.StatusOK, resp)
	})
}

func getEntry(e Entries) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValue(w, r, "id", validID)
		if !ok {
			return
		}
		owner, ok := readOwner(w, r)
		if !ok {
			return
		}
		entry, err := e.GetEntry(r.Context(), owner, id)
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
			Batch:   toBatchJSON(batch),
			Entries: toEntriesJSON(entries),
		})
	})
}

func patchEntry(e Entries) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValue(w, r, "id", validID)
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
		id, ok := pathValue(w, r, "id", validID)
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
