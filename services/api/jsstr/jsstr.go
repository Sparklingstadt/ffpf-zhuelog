// Package jsstr reproduces the JavaScript string operations the web app's
// validation relies on (trim, toLowerCase), so the API judges
// input exactly as the web does.
package jsstr

import "strings"

// IsSpace reports whether r is ECMAScript WhiteSpace or LineTerminator, the
// set String.prototype.trim() removes.
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

// ToLower is String.prototype.toLowerCase for the cases that matter here: it
// is strings.ToLower except that U+0130 (LATIN CAPITAL LETTER I WITH DOT
// ABOVE) becomes "i" followed by U+0307 as in JS, not "i". JS's
// context-dependent final sigma is not reproduced (capital sigma always
// becomes the medial form).
func ToLower(s string) string {
	return strings.ToLower(strings.ReplaceAll(s, "\u0130", "i\u0307"))
}
