package httpapi

import (
	"encoding/base64"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

func ptr[T any](v T) *T { return &v }

func validInput() entryInput {
	return entryInput{OriginalText: "原文", CorrectedText: "訂正", Pinyin: "yuan wen"}
}

func TestValidateDraftRuneLimits(t *testing.T) {
	fields := map[string]func(in *entryInput, s string){
		"originalText":  func(in *entryInput, s string) { in.OriginalText = s },
		"correctedText": func(in *entryInput, s string) { in.CorrectedText = s },
		"pinyin":        func(in *entryInput, s string) { in.Pinyin = s },
	}
	for name, set := range fields {
		t.Run(name, func(t *testing.T) {
			in := validInput()
			set(&in, strings.Repeat("汉", 2000))
			if _, err := validateDraft(in); err != nil {
				t.Fatalf("2000 runes rejected: %v", err)
			}
			set(&in, strings.Repeat("汉", 2001))
			if _, err := validateDraft(in); err == nil {
				t.Fatal("2001 runes accepted")
			}
		})
	}
	t.Run("hint", func(t *testing.T) {
		in := validInput()
		in.Hints = []string{strings.Repeat("汉", 500)}
		if _, err := validateDraft(in); err != nil {
			t.Fatalf("500 runes rejected: %v", err)
		}
		in.Hints = []string{strings.Repeat("汉", 501)}
		if _, err := validateDraft(in); err == nil {
			t.Fatal("501 runes accepted")
		}
	})
	t.Run("limit counts runes after trimming", func(t *testing.T) {
		in := validInput()
		in.OriginalText = "  " + strings.Repeat("汉", 2000) + "\n"
		if _, err := validateDraft(in); err != nil {
			t.Fatalf("rejected: %v", err)
		}
	})
}

func TestValidateDraft(t *testing.T) {
	t.Run("defaults and trims", func(t *testing.T) {
		in := entryInput{
			OriginalText:  "  a \n",
			CorrectedText: "\tb ",
			Pinyin:        " c ",
			Hints:         []string{" h1 ", "h2\n"},
		}
		got, err := validateDraft(in)
		if err != nil {
			t.Fatal(err)
		}
		want := store.EntryDraft{Kind: "correction", OriginalText: "a", CorrectedText: "b", Pinyin: "c", Hints: []string{"h1", "h2"}}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %+v, want %+v", got, want)
		}
	})
	t.Run("missing hints become an empty list", func(t *testing.T) {
		got, err := validateDraft(validInput())
		if err != nil {
			t.Fatal(err)
		}
		if got.Hints == nil || len(got.Hints) != 0 {
			t.Fatalf("Hints = %#v, want empty non-nil", got.Hints)
		}
	})
	t.Run("kinds", func(t *testing.T) {
		for _, k := range []string{"correction", "translation"} {
			in := validInput()
			in.Kind = ptr(k)
			got, err := validateDraft(in)
			if err != nil || got.Kind != k {
				t.Fatalf("kind %q: got %q, %v", k, got.Kind, err)
			}
		}
		for _, k := range []string{"foo", "", "Correction", " correction"} {
			in := validInput()
			in.Kind = ptr(k)
			if _, err := validateDraft(in); err == nil {
				t.Fatalf("kind %q accepted", k)
			}
		}
	})
	invalid := map[string]func(in *entryInput){
		"empty originalText":    func(in *entryInput) { in.OriginalText = "" },
		"blank originalText":    func(in *entryInput) { in.OriginalText = " \n\t" },
		"blank correctedText":   func(in *entryInput) { in.CorrectedText = "  " },
		"blank pinyin":          func(in *entryInput) { in.Pinyin = "" },
		"21 hints":              func(in *entryInput) { in.Hints = make([]string, 21); fill(in.Hints, "h") },
		"empty hint":            func(in *entryInput) { in.Hints = []string{"ok", ""} },
		"blank hint":            func(in *entryInput) { in.Hints = []string{"  "} },
		"NUL in originalText":   func(in *entryInput) { in.OriginalText = "a\x00b" },
		"NUL in correctedText":  func(in *entryInput) { in.CorrectedText = "a\x00" },
		"NUL in pinyin":         func(in *entryInput) { in.Pinyin = "\x00a" },
		"NUL in hint":           func(in *entryInput) { in.Hints = []string{"a\x00"} },
		"NUL only originalText": func(in *entryInput) { in.OriginalText = "\x00" },
	}
	for name, mutate := range invalid {
		t.Run(name, func(t *testing.T) {
			in := validInput()
			mutate(&in)
			if _, err := validateDraft(in); err == nil {
				t.Fatal("accepted")
			}
		})
	}
	t.Run("20 hints pass", func(t *testing.T) {
		in := validInput()
		in.Hints = make([]string, 20)
		fill(in.Hints, "h")
		if _, err := validateDraft(in); err != nil {
			t.Fatal(err)
		}
	})
}

func fill(s []string, v string) {
	for i := range s {
		s[i] = v
	}
}

func TestValidatePatch(t *testing.T) {
	t.Run("empty patch is rejected", func(t *testing.T) {
		if _, err := validatePatch(patchInput{}); err == nil {
			t.Fatal("accepted")
		}
	})
	t.Run("empty hints list clears hints", func(t *testing.T) {
		got, err := validatePatch(patchInput{Hints: &[]string{}})
		if err != nil {
			t.Fatal(err)
		}
		if got.Hints == nil || len(*got.Hints) != 0 {
			t.Fatalf("Hints = %#v, want pointer to empty list", got.Hints)
		}
		if got.Kind != nil || got.OriginalText != nil || got.CorrectedText != nil || got.Pinyin != nil {
			t.Fatalf("unexpected fields set: %+v", got)
		}
	})
	t.Run("fields are trimmed", func(t *testing.T) {
		got, err := validatePatch(patchInput{
			Kind:          ptr("translation"),
			OriginalText:  ptr(" a "),
			CorrectedText: ptr("b\n"),
			Pinyin:        ptr(" c"),
			Hints:         &[]string{" h "},
		})
		if err != nil {
			t.Fatal(err)
		}
		if *got.Kind != "translation" || *got.OriginalText != "a" || *got.CorrectedText != "b" || *got.Pinyin != "c" || !reflect.DeepEqual(*got.Hints, []string{"h"}) {
			t.Fatalf("got %+v", got)
		}
	})
	invalid := map[string]patchInput{
		"bad kind":       {Kind: ptr("foo")},
		"empty kind":     {Kind: ptr("")},
		"blank original": {OriginalText: ptr(" ")},
		"blank pinyin":   {Pinyin: ptr("")},
		"long corrected": {CorrectedText: ptr(strings.Repeat("汉", 2001))},
		"NUL":            {OriginalText: ptr("a\x00")},
		"NUL hint":       {Hints: &[]string{"a\x00"}},
		"empty hint":     {Hints: &[]string{""}},
		"long hint":      {Hints: &[]string{strings.Repeat("汉", 501)}},
		"21 hints":       {Hints: ptr(make([]string, 21))},
	}
	for name, in := range invalid {
		t.Run(name, func(t *testing.T) {
			if _, err := validatePatch(in); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}

func TestCursorRoundTrip(t *testing.T) {
	c := store.Cursor{CreatedAt: time.Date(2026, 10, 20, 12, 34, 56, 789_000_000, time.UTC), ID: "cabc123"}
	s := encodeCursor(c)
	if strings.ContainsAny(s, "=+/") {
		t.Fatalf("cursor %q is not unpadded base64url", s)
	}
	got, err := decodeCursor(s)
	if err != nil {
		t.Fatal(err)
	}
	if !got.CreatedAt.Equal(c.CreatedAt) || got.ID != c.ID {
		t.Fatalf("got %+v, want %+v", got, c)
	}
	if got.CreatedAt.Location() != time.UTC {
		t.Fatalf("location = %v, want UTC", got.CreatedAt.Location())
	}
	raw, _ := base64.RawURLEncoding.DecodeString(s)
	if string(raw) != strconv.FormatInt(c.CreatedAt.UnixMilli(), 10)+"|cabc123" {
		t.Fatalf("payload = %q", raw)
	}
}

func TestDecodeCursorRejects(t *testing.T) {
	enc := func(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }
	cases := map[string]string{
		"not base64":         "!!!",
		"padded base64":      base64.URLEncoding.EncodeToString([]byte("1|abc")),
		"empty":              "",
		"no separator":       enc("1700000000000"),
		"empty id":           enc("1700000000000|"),
		"empty time":         enc("|abc"),
		"time not a number":  enc("yesterday|abc"),
		"time with fraction": enc("1.5|abc"),
		"negative time":      enc("-1|abc"),
		"time overflows":     enc("99999999999999999999|abc"),
		"time beyond 9999":   enc("999999999999999|abc"),
		"extra element":      enc("1700000000000|abc|def"),
		"NUL in id":          enc("1700000000000|a\x00b"),
		"invalid UTF-8 id":   enc("1700000000000|\xff"),
	}
	for name, s := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeCursor(s); err == nil {
				t.Fatalf("decodeCursor(%q) accepted", s)
			}
		})
	}
}
