package httpapi

import (
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const maxIDBytes = 128

var errCursor = errors.New("httpapi: invalid cursor")

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
