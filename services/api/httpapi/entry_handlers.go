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
