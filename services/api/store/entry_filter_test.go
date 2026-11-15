package store

import (
	"context"
	"slices"
	"sort"
	"testing"
)

func TestListAndCountEntriesFilter(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)

	ofOwner := []EntryDraft{
		{Kind: "correction", OriginalText: "我昨天去学校", CorrectedText: "我昨天去了学校", Pinyin: "wǒ zuótiān qù le xuéxiào", Hints: []string{"了の位置"}},
		{Kind: "translation", OriginalText: "学校に行きます", CorrectedText: "我去学校", Pinyin: "wǒ qù xuéxiào", Hints: []string{"去 + 場所"}},
		{Kind: "correction", OriginalText: "他很高兴", CorrectedText: "他很高兴。", Pinyin: "Tā hěn GāoXìng", Hints: []string{"句点を忘れない", "了は要らない"}},
	}
	created := createTied(t, s, owner, ofOwner, fixedNow())
	createTied(t, s, other, []EntryDraft{{Kind: "correction", OriginalText: "学校", CorrectedText: "学校", Pinyin: "xuéxiào", Hints: []string{"了の位置"}}}, fixedNow())
	trashed := createTied(t, s, owner, []EntryDraft{{Kind: "correction", OriginalText: "学校のごみ", CorrectedText: "学校", Pinyin: "x", Hints: []string{"了"}}}, fixedNow())
	if err := s.TrashEntry(ctx, owner, trashed[0].ID, fixedNow()); err != nil {
		t.Fatal(err)
	}

	originals := func(f EntryFilter) []string {
		t.Helper()
		list, err := s.ListEntries(ctx, owner, f, nil, 50)
		if err != nil {
			t.Fatal(err)
		}
		n, err := s.CountEntries(ctx, owner, f)
		if err != nil {
			t.Fatal(err)
		}
		if n != len(list) {
			t.Errorf("filter %+v: count %d, list %d", f, n, len(list))
		}
		out := make([]string, len(list))
		for i, e := range list {
			out[i] = e.OriginalText
		}
		sort.Strings(out)
		return out
	}
	eq := func(name string, got []string, want ...string) {
		t.Helper()
		sort.Strings(want)
		if len(got) != len(want) {
			t.Errorf("%s = %q, want %q", name, got, want)
			return
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("%s = %q, want %q", name, got, want)
				return
			}
		}
	}

	eq("no filter", originals(EntryFilter{}), "我昨天去学校", "学校に行きます", "他很高兴")
	eq("q in corrected text", originals(EntryFilter{Query: "去了"}), "我昨天去学校")
	eq("q in written text", originals(EntryFilter{Query: "行きます"}), "学校に行きます")
	eq("q in pinyin ignores case", originals(EntryFilter{Query: "gāoxìng"}), "他很高兴")
	eq("q in a hint", originals(EntryFilter{Query: "句点"}), "他很高兴")
	eq("q matches several", originals(EntryFilter{Query: "学校"}), "我昨天去学校", "学校に行きます")
	eq("kind", originals(EntryFilter{Kind: "translation"}), "学校に行きます")
	eq("hint only", originals(EntryFilter{Hint: "了"}), "我昨天去学校", "他很高兴")
	eq("hint is not written text", originals(EntryFilter{Hint: "学校"}))
	eq("all together", originals(EntryFilter{Query: "学校", Kind: "correction", Hint: "了"}), "我昨天去学校")
	eq("LIKE characters are literal", originals(EntryFilter{Query: "%"}))
	eq("nothing", originals(EntryFilter{Query: "没有这个"}))

	// The cursor still pages through the filtered notes.
	page, err := s.ListEntries(ctx, owner, EntryFilter{Query: "学校"}, nil, 1)
	if err != nil || len(page) != 1 {
		t.Fatalf("first page = %v, %v", page, err)
	}
	rest, err := s.ListEntries(ctx, owner, EntryFilter{Query: "学校"}, &Cursor{CreatedAt: page[0].CreatedAt, ID: page[0].ID}, 10)
	if err != nil || len(rest) != 1 || rest[0].ID == page[0].ID {
		t.Fatalf("second page = %v, %v", rest, err)
	}
	if len(rest[0].Hints) == 0 || created[0].ID == "" {
		t.Error("filtered notes keep their hints")
	}
}

// The search uses LIKE (so a trigram index can serve it), but %, _ and \ in
// the search term are literal characters, as they were with strpos: each
// matches only the note that contains it.
func TestEntryFilterLikeCharactersAreLiteral(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	createTied(t, s, owner, []EntryDraft{
		{Kind: "correction", OriginalText: "百分之百 100%", CorrectedText: "c1", Pinyin: "p1", Hints: []string{"h"}},
		{Kind: "correction", OriginalText: "snake_case", CorrectedText: "c2", Pinyin: "p2", Hints: []string{"h"}},
		{Kind: "correction", OriginalText: `C:\path`, CorrectedText: "c3", Pinyin: "p3", Hints: []string{"h"}},
		{Kind: "correction", OriginalText: "plain 1000 snakeXcase Cpath", CorrectedText: "c4", Pinyin: "p4", Hints: []string{`hint 50\% off_line`}},
	}, fixedNow())

	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"%", []string{"百分之百 100%", "plain 1000 snakeXcase Cpath"}}, // the hint has 50\%
		{"0%", []string{"百分之百 100%"}},
		{"%%", nil},
		{"_", []string{"snake_case", "plain 1000 snakeXcase Cpath"}}, // the hint has off_line
		{"e_c", []string{"snake_case"}},
		{`\`, []string{`C:\path`, "plain 1000 snakeXcase Cpath"}}, // the hint has 50\%
		{`:\p`, []string{`C:\path`}},
		{`\%`, []string{"plain 1000 snakeXcase Cpath"}},
		{`\\`, nil},
		{"SNAKE_CASE", []string{"snake_case"}},
	} {
		{
			f := EntryFilter{Query: tc.query}
			list, err := s.ListEntries(ctx, owner, f, nil, 50)
			if err != nil {
				t.Fatal(err)
			}
			n, err := s.CountEntries(ctx, owner, f)
			if err != nil {
				t.Fatal(err)
			}
			got := make([]string, len(list))
			for i, e := range list {
				got[i] = e.OriginalText
			}
			sort.Strings(got)
			want := append([]string(nil), tc.want...)
			sort.Strings(want)
			if len(got) != len(want) || n != len(want) || !slices.Equal(got, want) {
				t.Errorf("query %q: list %q, count %d; want %q", tc.query, got, n, want)
			}
		}
	}
	// Hint-only search escapes the same way.
	for query, want := range map[string]int{`\%`: 1, "_": 1, "%": 1, "x%": 0} {
		if n, err := s.CountEntries(ctx, owner, EntryFilter{Hint: query}); err != nil || n != want {
			t.Errorf("hint %q: count %d, %v; want %d", query, n, err, want)
		}
	}
}
