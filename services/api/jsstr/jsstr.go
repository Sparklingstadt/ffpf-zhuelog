// Package jsstr reproduces the JavaScript string operations the web app's
// validation relies on (trim, length, slice, toLowerCase), so the API judges
// input exactly as the web does.
package jsstr

import (
	"strings"
	"unicode/utf16"
)

// IsSpace reports whether r is ECMAScript WhiteSpace or LineTerminator, the
// set String.prototype.trim() removes (and csv-parse's trim option skips).
// U+0085, U+180E and U+200B are not in it.
func IsSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00A0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

// Trim is String.prototype.trim.
func Trim(s string) string { return strings.TrimFunc(s, IsSpace) }

// Len is JS s.length: the number of UTF-16 code units. An invalid UTF-8 byte
// counts as one unit (it decodes to U+FFFD).
func Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// Truncate keeps the first n UTF-16 code units of s, like JS s.slice(0, n).
// A surrogate pair cut in half leaves a lone surrogate in JS, which is stored
// as U+FFFD, so that is what is returned in its place.
func Truncate(s string, n int) string {
	units := 0
	for i, r := range s {
		w := utf16.RuneLen(r)
		if w < 1 {
			w = 1
		}
		if units+w > n {
			if units < n {
				return s[:i] + "\uFFFD"
			}
			return s[:i]
		}
		units += w
	}
	return s
}

// ToLower is String.prototype.toLowerCase for the cases that matter here: it
// is strings.ToLower except that U+0130 (LATIN CAPITAL LETTER I WITH DOT
// ABOVE) becomes "i" followed by U+0307 as in JS, not "i". JS's
// context-dependent final sigma is not reproduced (capital sigma always
// becomes the medial form).
func ToLower(s string) string {
	return strings.ToLower(strings.ReplaceAll(s, "\u0130", "i\u0307"))
}
