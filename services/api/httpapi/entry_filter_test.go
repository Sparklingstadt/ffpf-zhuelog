package httpapi

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

func filterRouter(t *testing.T) (http.Handler, *fakeEntries) {
	t.Helper()
	f := &fakeEntries{list: func(context.Context, string, *store.Cursor, int) ([]store.Entry, error) {
		return nil, nil
	}}
	h, _ := entriesRouter(t, f)
	return h, f
}

func TestListEntriesPassesTheFilterToListAndCount(t *testing.T) {
	h, f := filterRouter(t)
	q := url.Values{"q": {"  学校 "}, "kind": {"translation"}, "hint": {"了の位置"}}
	w := do(h, http.MethodGet, "/v1/entries?"+q.Encode(), "", authHeader)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %q", w.Code, w.Body)
	}
	want := store.EntryFilter{Query: "学校", Kind: "translation", Hint: "了の位置"}
	if f.listFilter != want || f.countFilter != want {
		t.Fatalf("list filter %+v, count filter %+v, want %+v", f.listFilter, f.countFilter, want)
	}
}

func TestListEntriesWithoutFilterFiltersNothing(t *testing.T) {
	h, f := filterRouter(t)
	if w := do(h, http.MethodGet, "/v1/entries?q=&kind=&hint=", "", authHeader); w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	if f.listFilter != (store.EntryFilter{}) {
		t.Fatalf("filter = %+v, want none", f.listFilter)
	}
}

func TestListEntriesRejectsBadFilters(t *testing.T) {
	h, _ := filterRouter(t)
	for _, query := range []string{
		"kind=other",
		"q=" + url.QueryEscape(strings.Repeat("学", 101)),
		"hint=" + url.QueryEscape(strings.Repeat("a", 101)),
		"q=a&q=b",
		"kind=correction&kind=translation",
	} {
		wantError(t, do(h, http.MethodGet, "/v1/entries?"+query, "", authHeader), http.StatusBadRequest, "invalid_request")
	}
	// 100 characters are still fine.
	if w := do(h, http.MethodGet, "/v1/entries?q="+url.QueryEscape(strings.Repeat("学", 100)), "", authHeader); w.Code != http.StatusOK {
		t.Fatalf("100 characters: status = %d", w.Code)
	}
}
