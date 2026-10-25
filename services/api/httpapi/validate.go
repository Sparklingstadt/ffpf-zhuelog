package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	maxTextRunes    = 2000
	maxHintRunes    = 500
	maxHints        = 20
	maxBatchEntries = 500
	maxIDBytes      = 128

	kindCorrection  = "correction"
	kindTranslation = "translation"
)

var errCursor = errors.New("httpapi: invalid cursor")

// entryInput is the content of one entry to create, as received. A nil Kind
// means "correction".
type entryInput struct {
	Kind          *string
	OriginalText  string
	CorrectedText string
	Pinyin        string
	Hints         []string
}

// patchInput holds the fields of a PATCH; nil fields are not changed. A
// non-nil Hints (even an empty one) replaces all hints.
type patchInput struct {
	Kind          *string
	OriginalText  *string
	CorrectedText *string
	Pinyin        *string
	Hints         *[]string
}

func validateKind(s string) (string, error) {
	switch s {
	case kindCorrection, kindTranslation:
		return s, nil
	}
	return "", errors.New("kind must be correction or translation")
}

// cleanText trims s and checks it is non-empty, has no NUL and is at most max
// runes long.
func cleanText(name, s string, max int) (string, error) {
	s = strings.TrimSpace(s)
	switch {
	case s == "":
		return "", fmt.Errorf("%s is empty", name)
	case strings.ContainsRune(s, 0):
		return "", fmt.Errorf("%s contains NUL", name)
	case utf8.RuneCountInString(s) > max:
		return "", fmt.Errorf("%s is longer than %d characters", name, max)
	}
	return s, nil
}

func cleanHints(in []string) ([]string, error) {
	if len(in) > maxHints {
		return nil, fmt.Errorf("more than %d hints", maxHints)
	}
	out := make([]string, len(in))
	for i, h := range in {
		c, err := cleanText("hint", h, maxHintRunes)
		if err != nil {
			return nil, err
		}
		out[i] = c
	}
	return out, nil
}

// validateDraft checks and normalises an entry to create. The returned draft
// always has non-nil Hints.
func validateDraft(in entryInput) (store.EntryDraft, error) {
	kind := kindCorrection
	if in.Kind != nil {
		k, err := validateKind(*in.Kind)
		if err != nil {
			return store.EntryDraft{}, err
		}
		kind = k
	}
	original, err := cleanText("originalText", in.OriginalText, maxTextRunes)
	if err != nil {
		return store.EntryDraft{}, err
	}
	corrected, err := cleanText("correctedText", in.CorrectedText, maxTextRunes)
	if err != nil {
		return store.EntryDraft{}, err
	}
	pinyin, err := cleanText("pinyin", in.Pinyin, maxTextRunes)
	if err != nil {
		return store.EntryDraft{}, err
	}
	hints, err := cleanHints(in.Hints)
	if err != nil {
		return store.EntryDraft{}, err
	}
	return store.EntryDraft{Kind: kind, OriginalText: original, CorrectedText: corrected, Pinyin: pinyin, Hints: hints}, nil
}

// validatePatch checks and normalises the given fields of a PATCH. A patch
// that changes nothing is an error.
func validatePatch(in patchInput) (store.EntryPatch, error) {
	var p store.EntryPatch
	if in.Kind == nil && in.OriginalText == nil && in.CorrectedText == nil && in.Pinyin == nil && in.Hints == nil {
		return p, errors.New("patch has no fields")
	}
	if in.Kind != nil {
		k, err := validateKind(*in.Kind)
		if err != nil {
			return p, err
		}
		p.Kind = &k
	}
	for _, f := range []struct {
		name string
		in   *string
		out  **string
	}{
		{"originalText", in.OriginalText, &p.OriginalText},
		{"correctedText", in.CorrectedText, &p.CorrectedText},
		{"pinyin", in.Pinyin, &p.Pinyin},
	} {
		if f.in == nil {
			continue
		}
		c, err := cleanText(f.name, *f.in, maxTextRunes)
		if err != nil {
			return store.EntryPatch{}, err
		}
		*f.out = &c
	}
	if in.Hints != nil {
		h, err := cleanHints(*in.Hints)
		if err != nil {
			return store.EntryPatch{}, err
		}
		p.Hints = &h
	}
	return p, nil
}

// validID reports whether s can be used as a row ID in a query: non-empty,
// short, valid UTF-8 and free of NUL (which PostgreSQL rejects).
func validID(s string) bool {
	return s != "" && len(s) <= maxIDBytes && utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}

// encodeCursor serialises c as base64url("<createdAt unix ms>|<id>").
func encodeCursor(c store.Cursor) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(c.CreatedAt.UnixMilli(), 10) + "|" + c.ID))
}

// decodeCursor is the inverse of encodeCursor.
func decodeCursor(s string) (store.Cursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return store.Cursor{}, errCursor
	}
	ms, id, ok := strings.Cut(string(raw), "|")
	if !ok || strings.Contains(id, "|") || !validID(id) {
		return store.Cursor{}, errCursor
	}
	n, err := strconv.ParseInt(ms, 10, 64)
	if err != nil || n < 0 {
		return store.Cursor{}, errCursor
	}
	t := time.UnixMilli(n).UTC()
	if t.Year() > 9999 {
		return store.Cursor{}, errCursor
	}
	return store.Cursor{CreatedAt: t, ID: id}, nil
}

// optString is a string field that records whether it was present and rejects
// JSON null.
type optString struct {
	Set   bool
	Value string
}

func (o *optString) UnmarshalJSON(b []byte) error {
	var s jsonString
	if err := s.UnmarshalJSON(b); err != nil {
		return err
	}
	o.Set, o.Value = true, string(s)
	return nil
}

// optStrings is an array-of-strings field that records whether it was present
// and rejects JSON null, both for the array and for its elements.
type optStrings struct {
	Set   bool
	Value []string
}

func (o *optStrings) UnmarshalJSON(b []byte) error {
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		return errors.New("httpapi: null is not an array")
	}
	var items []*string
	if err := json.Unmarshal(b, &items); err != nil {
		return err
	}
	out := make([]string, len(items))
	for i, p := range items {
		if p == nil {
			return errors.New("httpapi: null is not a string")
		}
		out[i] = *p
	}
	o.Set, o.Value = true, out
	return nil
}

// entryBody is the JSON form of an entry for both creation and PATCH.
type entryBody struct {
	Kind          optString  `json:"kind"`
	OriginalText  optString  `json:"originalText"`
	CorrectedText optString  `json:"correctedText"`
	Pinyin        optString  `json:"pinyin"`
	Hints         optStrings `json:"hints"`
}

func (b entryBody) draftInput() entryInput {
	in := entryInput{
		OriginalText:  b.OriginalText.Value,
		CorrectedText: b.CorrectedText.Value,
		Pinyin:        b.Pinyin.Value,
		Hints:         b.Hints.Value,
	}
	if b.Kind.Set {
		in.Kind = &b.Kind.Value
	}
	return in
}

func (b entryBody) patchInput() patchInput {
	var in patchInput
	if b.Kind.Set {
		in.Kind = &b.Kind.Value
	}
	if b.OriginalText.Set {
		in.OriginalText = &b.OriginalText.Value
	}
	if b.CorrectedText.Set {
		in.CorrectedText = &b.CorrectedText.Value
	}
	if b.Pinyin.Set {
		in.Pinyin = &b.Pinyin.Value
	}
	if b.Hints.Set {
		in.Hints = &b.Hints.Value
	}
	return in
}
