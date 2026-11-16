package httpapi

import (
	"strings"
	"unicode/utf8"
)

const maxIDBytes = 128

// validID reports whether s can be used as a row ID in a query: non-empty,
// short, valid UTF-8 and free of NUL (which PostgreSQL rejects).
func validID(s string) bool {
	return s != "" && len(s) <= maxIDBytes && utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}
