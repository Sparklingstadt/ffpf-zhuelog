package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const testOwner = "password:owner1"

var authHeader = map[string]string{"Authorization": "Bearer tok"}

// fakeEntries implements Entries with per-method hooks; an unset hook returns
// a sentinel error (which maps to 500).
type fakeEntries struct {
	list   func(ctx context.Context, ownerID string, after *store.Cursor, limit int) ([]store.Entry, error)
	get    func(ctx context.Context, ownerID, id string) (store.Entry, error)
	create func(ctx context.Context, ownerID string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error)
	// createImport serves CreateImportBatch.
	createImport func(ctx context.Context, ownerID, fileName string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error)
	update       func(ctx context.Context, ownerID, id string, p store.EntryPatch) (store.Entry, error)
	trash        func(ctx context.Context, ownerID, id string, now time.Time) error

	// count and countTrashed default to 0 when unset.
	count        func(ctx context.Context, ownerID string) (int, error)
	countTrashed func(ctx context.Context, ownerID string) (int, error)
	listTrashed  func(ctx context.Context, ownerID string, after *store.Cursor, limit int) ([]store.TrashedEntry, error)
	restore      func(ctx context.Context, ownerID, id string) (store.Entry, error)
	purge        func(ctx context.Context, ownerID, id string) error
	emptyTrash   func(ctx context.Context, ownerID string) (int, error)
	setShared    func(ctx context.Context, ownerID, id string, shared bool, now time.Time) (store.Entry, error)

	logDates     func(ctx context.Context, ownerID string) ([]store.LogDateCount, error)
	dailyEntries func(ctx context.Context, ownerID string, d store.LogDate) ([]store.Entry, error)
	dailyEntry   func(ctx context.Context, ownerID string, d store.LogDate, number int) (store.Entry, int, error)
}

func (f *fakeEntries) ListLogDates(ctx context.Context, ownerID string) ([]store.LogDateCount, error) {
	if f.logDates == nil {
		return nil, errUnexpectedCall{"ListLogDates"}
	}
	return f.logDates(ctx, ownerID)
}

func (f *fakeEntries) ListDailyEntries(ctx context.Context, ownerID string, d store.LogDate) ([]store.Entry, error) {
	if f.dailyEntries == nil {
		return nil, errUnexpectedCall{"ListDailyEntries"}
	}
	return f.dailyEntries(ctx, ownerID, d)
}

func (f *fakeEntries) GetDailyEntry(ctx context.Context, ownerID string, d store.LogDate, number int) (store.Entry, int, error) {
	if f.dailyEntry == nil {
		return store.Entry{}, 0, errUnexpectedCall{"GetDailyEntry"}
	}
	return f.dailyEntry(ctx, ownerID, d, number)
}

func (f *fakeEntries) ListTrashed(ctx context.Context, ownerID string, after *store.Cursor, limit int) ([]store.TrashedEntry, error) {
	if f.listTrashed == nil {
		return nil, errUnexpectedCall{"ListTrashed"}
	}
	return f.listTrashed(ctx, ownerID, after, limit)
}

func (f *fakeEntries) RestoreEntry(ctx context.Context, ownerID, id string) (store.Entry, error) {
	if f.restore == nil {
		return store.Entry{}, errUnexpectedCall{"RestoreEntry"}
	}
	return f.restore(ctx, ownerID, id)
}

func (f *fakeEntries) PurgeEntry(ctx context.Context, ownerID, id string) error {
	if f.purge == nil {
		return errUnexpectedCall{"PurgeEntry"}
	}
	return f.purge(ctx, ownerID, id)
}

func (f *fakeEntries) EmptyTrash(ctx context.Context, ownerID string) (int, error) {
	if f.emptyTrash == nil {
		return 0, errUnexpectedCall{"EmptyTrash"}
	}
	return f.emptyTrash(ctx, ownerID)
}

func (f *fakeEntries) SetShared(ctx context.Context, ownerID, id string, shared bool, now time.Time) (store.Entry, error) {
	if f.setShared == nil {
		return store.Entry{}, errUnexpectedCall{"SetShared"}
	}
	return f.setShared(ctx, ownerID, id, shared, now)
}

func (f *fakeEntries) CountEntries(ctx context.Context, ownerID string) (int, error) {
	if f.count == nil {
		return 0, nil
	}
	return f.count(ctx, ownerID)
}

func (f *fakeEntries) CountTrashed(ctx context.Context, ownerID string) (int, error) {
	if f.countTrashed == nil {
		return 0, nil
	}
	return f.countTrashed(ctx, ownerID)
}

func (f *fakeEntries) ListEntries(ctx context.Context, ownerID string, after *store.Cursor, limit int) ([]store.Entry, error) {
	if f.list == nil {
		return nil, errUnexpectedCall{"ListEntries"}
	}
	return f.list(ctx, ownerID, after, limit)
}

func (f *fakeEntries) GetEntry(ctx context.Context, ownerID, id string) (store.Entry, error) {
	if f.get == nil {
		return store.Entry{}, errUnexpectedCall{"GetEntry"}
	}
	return f.get(ctx, ownerID, id)
}

func (f *fakeEntries) CreateBatch(ctx context.Context, ownerID string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error) {
	if f.create == nil {
		return store.Batch{}, nil, errUnexpectedCall{"CreateBatch"}
	}
	return f.create(ctx, ownerID, drafts, now)
}

func (f *fakeEntries) CreateImportBatch(ctx context.Context, ownerID, fileName string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error) {
	if f.createImport == nil {
		return store.Batch{}, nil, errUnexpectedCall{"CreateImportBatch"}
	}
	return f.createImport(ctx, ownerID, fileName, drafts, now)
}

func (f *fakeEntries) UpdateEntry(ctx context.Context, ownerID, id string, p store.EntryPatch) (store.Entry, error) {
	if f.update == nil {
		return store.Entry{}, errUnexpectedCall{"UpdateEntry"}
	}
	return f.update(ctx, ownerID, id, p)
}

func (f *fakeEntries) TrashEntry(ctx context.Context, ownerID, id string, now time.Time) error {
	if f.trash == nil {
		return errUnexpectedCall{"TrashEntry"}
	}
	return f.trash(ctx, ownerID, id, now)
}

func entriesRouter(t *testing.T, e Entries) (http.Handler, *clock) {
	t.Helper()
	h, c, _ := routerWith(t, "", Deps{Entries: e})
	return h, c
}

func sampleEntry(id string, created time.Time) store.Entry {
	return store.Entry{
		ID:            id,
		Kind:          "correction",
		OriginalText:  "原文",
		CorrectedText: "訂正",
		Pinyin:        "yuan wen",
		Hints:         []store.Hint{{ID: "h-" + id, Content: "ヒント", Position: 0}},
		CreatedAt:     created,
	}
}

type entryView struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"`
	OriginalText  string `json:"originalText"`
	CorrectedText string `json:"correctedText"`
	Pinyin        string `json:"pinyin"`
	Hints         []struct {
		ID       string `json:"id"`
		Content  string `json:"content"`
		Position int    `json:"position"`
	} `json:"hints"`
	CreatedAt string  `json:"createdAt"`
	SharedAt  *string `json:"sharedAt"`
}

func TestAllEntryRoutesRequireAuth(t *testing.T) {
	h, _ := entriesRouter(t, &fakeEntries{})
	routes := []struct{ method, target, body string }{
		{http.MethodGet, "/v1/entries", ""},
		{http.MethodGet, "/v1/entries/x", ""},
		{http.MethodPost, "/v1/batches", `{"entries":[]}`},
		{http.MethodPatch, "/v1/entries/x", `{"pinyin":"a"}`},
		{http.MethodDelete, "/v1/entries/x", ""},
	}
	for _, rt := range routes {
		t.Run(rt.method+" "+rt.target, func(t *testing.T) {
			wantError(t, do(h, rt.method, rt.target, rt.body, nil), http.StatusUnauthorized, "unauthorized")
		})
	}
}

func TestListEntriesHandler(t *testing.T) {
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	mk := func(n int) []store.Entry {
		out := make([]store.Entry, n)
		for i := range out {
			out[i] = sampleEntry("e"+strconv.Itoa(i), base.Add(-time.Duration(i)*time.Minute))
		}
		return out
	}

	t.Run("default limit asks for 51 and omits the cursor when short", func(t *testing.T) {
		var gotOwner string
		var gotLimit int
		var gotAfter *store.Cursor
		h, _ := entriesRouter(t, &fakeEntries{list: func(_ context.Context, owner string, after *store.Cursor, limit int) ([]store.Entry, error) {
			gotOwner, gotAfter, gotLimit = owner, after, limit
			return mk(2), nil
		}})
		w := do(h, http.MethodGet, "/v1/entries", "", authHeader)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
		}
		if gotOwner != testOwner || gotLimit != 51 || gotAfter != nil {
			t.Fatalf("store got owner=%q limit=%d after=%v", gotOwner, gotLimit, gotAfter)
		}
		var resp struct {
			Entries    []entryView `json:"entries"`
			NextCursor *string     `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 2 || resp.NextCursor != nil {
			t.Fatalf("entries=%d nextCursor=%v", len(resp.Entries), resp.NextCursor)
		}
		if !strings.Contains(w.Body.String(), `"nextCursor":null`) {
			t.Fatalf("nextCursor must be an explicit null: %s", w.Body.String())
		}
		e := resp.Entries[0]
		if e.ID != "e0" || e.Kind != "correction" || e.OriginalText != "原文" || e.CorrectedText != "訂正" || e.Pinyin != "yuan wen" ||
			e.CreatedAt != "2026-10-01T00:00:00.000Z" || e.SharedAt != nil ||
			len(e.Hints) != 1 || e.Hints[0].ID != "h-e0" || e.Hints[0].Content != "ヒント" || e.Hints[0].Position != 0 {
			t.Fatalf("entry = %+v", e)
		}
	})

	t.Run("exactly limit entries means no next page", func(t *testing.T) {
		h, _ := entriesRouter(t, &fakeEntries{list: func(_ context.Context, _ string, _ *store.Cursor, limit int) ([]store.Entry, error) {
			if limit != 3 {
				t.Errorf("limit = %d, want 3", limit)
			}
			return mk(2), nil
		}})
		w := do(h, http.MethodGet, "/v1/entries?limit=2", "", authHeader)
		if !strings.Contains(w.Body.String(), `"nextCursor":null`) {
			t.Fatalf("body = %s", w.Body.String())
		}
	})

	t.Run("limit+1 results drop the extra and set nextCursor from the last kept", func(t *testing.T) {
		h, _ := entriesRouter(t, &fakeEntries{list: func(_ context.Context, _ string, _ *store.Cursor, limit int) ([]store.Entry, error) {
			if limit != 3 {
				t.Errorf("limit = %d, want 3", limit)
			}
			return mk(3), nil
		}})
		w := do(h, http.MethodGet, "/v1/entries?limit=2", "", authHeader)
		var resp struct {
			Entries    []entryView `json:"entries"`
			NextCursor *string     `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Entries) != 2 || resp.Entries[1].ID != "e1" {
			t.Fatalf("entries = %+v", resp.Entries)
		}
		if resp.NextCursor == nil {
			t.Fatal("nextCursor is null")
		}
		c, err := decodeCursor(*resp.NextCursor)
		if err != nil {
			t.Fatal(err)
		}
		if c.ID != "e1" || !c.CreatedAt.Equal(base.Add(-time.Minute)) {
			t.Fatalf("cursor = %+v", c)
		}
	})

	t.Run("cursor is decoded and passed to the store", func(t *testing.T) {
		want := store.Cursor{CreatedAt: base, ID: "e9"}
		var got *store.Cursor
		h, _ := entriesRouter(t, &fakeEntries{list: func(_ context.Context, _ string, after *store.Cursor, _ int) ([]store.Entry, error) {
			got = after
			return nil, nil
		}})
		w := do(h, http.MethodGet, "/v1/entries?limit=100&cursor="+encodeCursor(want), "", authHeader)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		if got == nil || got.ID != want.ID || !got.CreatedAt.Equal(want.CreatedAt) {
			t.Fatalf("after = %+v", got)
		}
		if !strings.Contains(w.Body.String(), `"entries":[]`) {
			t.Fatalf("empty list must render as []: %s", w.Body.String())
		}
	})

	t.Run("empty cursor means first page", func(t *testing.T) {
		called := false
		h, _ := entriesRouter(t, &fakeEntries{list: func(_ context.Context, _ string, after *store.Cursor, _ int) ([]store.Entry, error) {
			called = true
			if after != nil {
				t.Errorf("after = %+v, want nil", after)
			}
			return nil, nil
		}})
		if w := do(h, http.MethodGet, "/v1/entries?cursor=", "", authHeader); w.Code != http.StatusOK || !called {
			t.Fatalf("status = %d, called = %v", w.Code, called)
		}
	})

	t.Run("sharedAt is formatted when present", func(t *testing.T) {
		shared := time.Date(2026, 10, 2, 3, 4, 5, 600_000_000, time.FixedZone("JST", 9*3600))
		e := sampleEntry("e0", base)
		e.SharedAt = &shared
		h, _ := entriesRouter(t, &fakeEntries{list: func(context.Context, string, *store.Cursor, int) ([]store.Entry, error) {
			return []store.Entry{e}, nil
		}})
		w := do(h, http.MethodGet, "/v1/entries", "", authHeader)
		if !strings.Contains(w.Body.String(), `"sharedAt":"2026-10-01T18:04:05.600Z"`) {
			t.Fatalf("body = %s", w.Body.String())
		}
	})
}

func TestListEntriesTotalIgnoresPaging(t *testing.T) {
	var gotOwner string
	h, _ := entriesRouter(t, &fakeEntries{
		list: func(_ context.Context, _ string, _ *store.Cursor, _ int) ([]store.Entry, error) {
			return []store.Entry{sampleEntry("a", time.Now()), sampleEntry("b", time.Now())}, nil
		},
		count: func(_ context.Context, owner string) (int, error) { gotOwner = owner; return 3, nil },
	})
	w := do(h, http.MethodGet, "/v1/entries?limit=1", "", authHeader)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
	}
	var resp struct {
		Entries    []entryView `json:"entries"`
		NextCursor *string     `json:"nextCursor"`
		Total      *int        `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Entries) != 1 || resp.NextCursor == nil || resp.Total == nil || *resp.Total != 3 || gotOwner != testOwner {
		t.Fatalf("entries=%d cursor=%v total=%v owner=%q", len(resp.Entries), resp.NextCursor, resp.Total, gotOwner)
	}
}

func TestListEntriesBadQuery(t *testing.T) {
	for _, q := range []string{
		"limit=0", "limit=101", "limit=abc", "limit=", "limit=-1", "limit=+5", "limit=1.5", "limit=1&limit=2",
		"limit=99999999999999999999", "cursor=!!!", "cursor=a&cursor=b", "limit=%zz",
	} {
		t.Run(q, func(t *testing.T) {
			h, _ := entriesRouter(t, &fakeEntries{}) // store must not be called
			wantError(t, do(h, http.MethodGet, "/v1/entries?"+q, "", authHeader), http.StatusBadRequest, "invalid_request")
		})
	}
}

func TestGetEntryHandler(t *testing.T) {
	t.Run("returns the entry", func(t *testing.T) {
		var gotOwner, gotID string
		h, _ := entriesRouter(t, &fakeEntries{get: func(_ context.Context, owner, id string) (store.Entry, error) {
			gotOwner, gotID = owner, id
			return sampleEntry(id, time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)), nil
		}})
		w := do(h, http.MethodGet, "/v1/entries/cabc", "", authHeader)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
		}
		var e entryView
		if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
			t.Fatal(err)
		}
		if gotOwner != testOwner || gotID != "cabc" || e.ID != "cabc" || e.SharedAt != nil {
			t.Fatalf("owner=%q id=%q entry=%+v", gotOwner, gotID, e)
		}
		if !strings.Contains(w.Body.String(), `"sharedAt":null`) {
			t.Fatalf("sharedAt must be an explicit null: %s", w.Body.String())
		}
	})
	t.Run("hints are always an array", func(t *testing.T) {
		h, _ := entriesRouter(t, &fakeEntries{get: func(context.Context, string, string) (store.Entry, error) {
			e := sampleEntry("x", time.Now())
			e.Hints = nil
			return e, nil
		}})
		w := do(h, http.MethodGet, "/v1/entries/x", "", authHeader)
		if !strings.Contains(w.Body.String(), `"hints":[]`) {
			t.Fatalf("body = %s", w.Body.String())
		}
	})
	t.Run("ErrNotFound is 404", func(t *testing.T) {
		h, _ := entriesRouter(t, &fakeEntries{get: func(context.Context, string, string) (store.Entry, error) {
			return store.Entry{}, store.ErrNotFound
		}})
		wantError(t, do(h, http.MethodGet, "/v1/entries/nope", "", authHeader), http.StatusNotFound, "not_found")
	})
	t.Run("an ID that cannot exist is 404 without a store call", func(t *testing.T) {
		h, _ := entriesRouter(t, &fakeEntries{})
		wantError(t, do(h, http.MethodGet, "/v1/entries/a%00b", "", authHeader), http.StatusNotFound, "not_found")
	})
}

func TestCreateBatchHandler(t *testing.T) {
	t.Run("201 with batch and entries; the store gets validated drafts", func(t *testing.T) {
		var gotOwner string
		var gotDrafts []store.EntryDraft
		var gotNow time.Time
		h, c := entriesRouter(t, &fakeEntries{create: func(_ context.Context, owner string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error) {
			gotOwner, gotDrafts, gotNow = owner, drafts, now
			out := make([]store.Entry, len(drafts))
			for i, d := range drafts {
				out[i] = store.Entry{ID: "e" + strconv.Itoa(i), Kind: d.Kind, OriginalText: d.OriginalText, CorrectedText: d.CorrectedText, Pinyin: d.Pinyin, CreatedAt: now}
				for j, hc := range d.Hints {
					out[i].Hints = append(out[i].Hints, store.Hint{ID: "h", Content: hc, Position: j})
				}
			}
			return store.Batch{ID: "cbatch", ImportedAt: now}, out, nil
		}})
		body := `{"entries":[
			{"originalText":" 我 ","correctedText":"你","pinyin":" ni ","hints":[" a ","b"]},
			{"kind":"translation","originalText":"x","correctedText":"y","pinyin":"z"}]}`
		w := do(h, http.MethodPost, "/v1/batches", body, authHeader)
		if w.Code != http.StatusCreated {
			t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
		}
		want := []store.EntryDraft{
			{Kind: "correction", OriginalText: "我", CorrectedText: "你", Pinyin: "ni", Hints: []string{"a", "b"}},
			{Kind: "translation", OriginalText: "x", CorrectedText: "y", Pinyin: "z", Hints: []string{}},
		}
		if gotOwner != testOwner || !reflect.DeepEqual(gotDrafts, want) || !gotNow.Equal(c.Now()) {
			t.Fatalf("owner=%q drafts=%+v now=%v", gotOwner, gotDrafts, gotNow)
		}
		var resp struct {
			Batch struct {
				ID         string `json:"id"`
				ImportedAt string `json:"importedAt"`
			} `json:"batch"`
			Entries []entryView `json:"entries"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if resp.Batch.ID != "cbatch" || resp.Batch.ImportedAt != "2026-10-20T12:00:00.000Z" || len(resp.Entries) != 2 ||
			resp.Entries[0].OriginalText != "我" || len(resp.Entries[0].Hints) != 2 || resp.Entries[1].Kind != "translation" {
			t.Fatalf("response = %s", w.Body.String())
		}
		if !strings.Contains(w.Body.String(), `"hints":[]`) {
			t.Fatalf("an entry without hints must render hints as []: %s", w.Body.String())
		}
	})

	entry := `{"originalText":"a","correctedText":"b","pinyin":"c"}`
	many := func(n int) string {
		return `{"entries":[` + strings.TrimSuffix(strings.Repeat(entry+",", n), ",") + `]}`
	}
	bad := map[string]string{
		"zero entries":        `{"entries":[]}`,
		"entries missing":     `{}`,
		"entries null":        `{"entries":null}`,
		"501 entries":         many(501),
		"null entry":          `{"entries":[null]}`,
		"invalid entry":       `{"entries":[` + entry + `,{"originalText":"a","correctedText":"","pinyin":"c"}]}`,
		"missing text field":  `{"entries":[{"originalText":"a","correctedText":"b"}]}`,
		"bad kind":            `{"entries":[{"kind":"foo","originalText":"a","correctedText":"b","pinyin":"c"}]}`,
		"null kind":           `{"entries":[{"kind":null,"originalText":"a","correctedText":"b","pinyin":"c"}]}`,
		"null text":           `{"entries":[{"originalText":null,"correctedText":"b","pinyin":"c"}]}`,
		"null hints":          `{"entries":[{"originalText":"a","correctedText":"b","pinyin":"c","hints":null}]}`,
		"null hint element":   `{"entries":[{"originalText":"a","correctedText":"b","pinyin":"c","hints":["x",null]}]}`,
		"non-string hint":     `{"entries":[{"originalText":"a","correctedText":"b","pinyin":"c","hints":[1]}]}`,
		"hints not an array":  `{"entries":[{"originalText":"a","correctedText":"b","pinyin":"c","hints":"x"}]}`,
		"21 hints":            `{"entries":[{"originalText":"a","correctedText":"b","pinyin":"c","hints":[` + strings.TrimSuffix(strings.Repeat(`"h",`, 21), ",") + `]}]}`,
		"NUL escape":          `{"entries":[{"originalText":"a\u0000","correctedText":"b","pinyin":"c"}]}`,
		"unknown entry field": `{"entries":[{"originalText":"a","correctedText":"b","pinyin":"c","sharedAt":"x"}]}`,
		"unknown top field":   `{"entries":[` + entry + `],"extra":1}`,
		"array body":          `[]`,
		"null body":           `null`,
		"invalid json":        `{"entries":`,
		"trailing data":       many(1) + ` {}`,
	}
	for name, body := range bad {
		t.Run("400 "+name, func(t *testing.T) {
			h, _ := entriesRouter(t, &fakeEntries{}) // the store must not be called
			wantError(t, do(h, http.MethodPost, "/v1/batches", body, authHeader), http.StatusBadRequest, "invalid_request")
		})
	}

	t.Run("500 entries are accepted", func(t *testing.T) {
		n := 0
		h, _ := entriesRouter(t, &fakeEntries{create: func(_ context.Context, _ string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error) {
			n = len(drafts)
			return store.Batch{ID: "b", ImportedAt: now}, nil, nil
		}})
		if w := do(h, http.MethodPost, "/v1/batches", many(500), authHeader); w.Code != http.StatusCreated || n != 500 {
			t.Fatalf("status = %d, drafts = %d", w.Code, n)
		}
	})

	t.Run("an oversized body is 413", func(t *testing.T) {
		h, _ := entriesRouter(t, &fakeEntries{})
		big := `{"entries":[{"originalText":"` + strings.Repeat("a", 1<<20) + `","correctedText":"b","pinyin":"c"}]}`
		wantError(t, do(h, http.MethodPost, "/v1/batches", big, authHeader), http.StatusRequestEntityTooLarge, "too_large")
	})
}

func TestPatchEntryHandler(t *testing.T) {
	t.Run("200 with the updated entry; the store gets the trimmed patch", func(t *testing.T) {
		var gotOwner, gotID string
		var gotPatch store.EntryPatch
		h, _ := entriesRouter(t, &fakeEntries{update: func(_ context.Context, owner, id string, p store.EntryPatch) (store.Entry, error) {
			gotOwner, gotID, gotPatch = owner, id, p
			e := sampleEntry(id, time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC))
			e.Pinyin = *p.Pinyin
			return e, nil
		}})
		w := do(h, http.MethodPatch, "/v1/entries/cabc", `{"pinyin":" new ","hints":[]}`, authHeader)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
		}
		if gotOwner != testOwner || gotID != "cabc" || gotPatch.Kind != nil || gotPatch.OriginalText != nil || gotPatch.CorrectedText != nil ||
			gotPatch.Pinyin == nil || *gotPatch.Pinyin != "new" || gotPatch.Hints == nil || len(*gotPatch.Hints) != 0 {
			t.Fatalf("owner=%q id=%q patch=%+v", gotOwner, gotID, gotPatch)
		}
		var e entryView
		if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
			t.Fatal(err)
		}
		if e.ID != "cabc" || e.Pinyin != "new" {
			t.Fatalf("entry = %+v", e)
		}
	})
	t.Run("ErrNotFound is 404", func(t *testing.T) {
		h, _ := entriesRouter(t, &fakeEntries{update: func(context.Context, string, string, store.EntryPatch) (store.Entry, error) {
			return store.Entry{}, store.ErrNotFound
		}})
		wantError(t, do(h, http.MethodPatch, "/v1/entries/nope", `{"kind":"translation"}`, authHeader), http.StatusNotFound, "not_found")
	})
	bad := map[string]string{
		"sharedAt":          `{"sharedAt":"2026-01-01T00:00:00.000Z"}`,
		"unknown field":     `{"pinyin":"a","id":"x"}`,
		"empty object":      `{}`,
		"hints null":        `{"hints":null}`,
		"null hint element": `{"hints":[null]}`,
		"kind null":         `{"kind":null}`,
		"text null":         `{"originalText":null}`,
		"bad kind":          `{"kind":"foo"}`,
		"blank text":        `{"correctedText":"  "}`,
		"too long":          `{"pinyin":"` + strings.Repeat("汉", 2001) + `"}`,
		"NUL":               `{"originalText":"a\u0000b"}`,
		"21 hints":          `{"hints":[` + strings.TrimSuffix(strings.Repeat(`"h",`, 21), ",") + `]}`,
		"array":             `[]`,
		"null body":         `null`,
		"empty body":        ``,
	}
	for name, body := range bad {
		t.Run("400 "+name, func(t *testing.T) {
			h, _ := entriesRouter(t, &fakeEntries{})
			wantError(t, do(h, http.MethodPatch, "/v1/entries/cabc", body, authHeader), http.StatusBadRequest, "invalid_request")
		})
	}
}

func TestDeleteEntryHandler(t *testing.T) {
	t.Run("204 with no body", func(t *testing.T) {
		var gotOwner, gotID string
		var gotNow time.Time
		h, c := entriesRouter(t, &fakeEntries{trash: func(_ context.Context, owner, id string, now time.Time) error {
			gotOwner, gotID, gotNow = owner, id, now
			return nil
		}})
		w := do(h, http.MethodDelete, "/v1/entries/cabc", "", authHeader)
		if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
			t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("missing Cache-Control: no-store")
		}
		if gotOwner != testOwner || gotID != "cabc" || !gotNow.Equal(c.Now()) {
			t.Fatalf("owner=%q id=%q now=%v", gotOwner, gotID, gotNow)
		}
	})
	t.Run("ErrNotFound is 404", func(t *testing.T) {
		h, _ := entriesRouter(t, &fakeEntries{trash: func(context.Context, string, string, time.Time) error { return store.ErrNotFound }})
		wantError(t, do(h, http.MethodDelete, "/v1/entries/nope", "", authHeader), http.StatusNotFound, "not_found")
	})
}

func TestEntryErrorsAreInternal(t *testing.T) {
	secret := errors.New("pq: connection to 10.0.0.5 refused (password=hunter2)")
	e := &fakeEntries{
		list: func(context.Context, string, *store.Cursor, int) ([]store.Entry, error) { return nil, secret },
		get:  func(context.Context, string, string) (store.Entry, error) { return store.Entry{}, secret },
		create: func(context.Context, string, []store.EntryDraft, time.Time) (store.Batch, []store.Entry, error) {
			return store.Batch{}, nil, secret
		},
		update: func(context.Context, string, string, store.EntryPatch) (store.Entry, error) {
			return store.Entry{}, secret
		},
		trash: func(context.Context, string, string, time.Time) error { return secret },
	}
	h, _ := entriesRouter(t, e)
	routes := []struct{ method, target, body string }{
		{http.MethodGet, "/v1/entries", ""},
		{http.MethodGet, "/v1/entries/x", ""},
		{http.MethodPost, "/v1/batches", `{"entries":[{"originalText":"a","correctedText":"b","pinyin":"c"}]}`},
		{http.MethodPatch, "/v1/entries/x", `{"pinyin":"a"}`},
		{http.MethodDelete, "/v1/entries/x", ""},
	}
	for _, rt := range routes {
		t.Run(rt.method+" "+rt.target, func(t *testing.T) {
			w := do(h, rt.method, rt.target, rt.body, authHeader)
			wantError(t, w, http.StatusInternalServerError, "internal")
			for _, leak := range []string{"hunter2", "10.0.0.5", "pq:"} {
				if strings.Contains(w.Body.String(), leak) {
					t.Fatalf("response leaks %q: %s", leak, w.Body.String())
				}
			}
		})
	}
}
