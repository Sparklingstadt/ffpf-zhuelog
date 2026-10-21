package jsstr

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// jsSpaces is every code point String.prototype.trim removes: ECMAScript
// WhiteSpace (TAB, VT, FF, SP, NBSP, ZWNBSP and the other Unicode Zs) and
// LineTerminator (LF, CR, LS, PS).
var jsSpaces = []rune{
	'\t', '\n', '\v', '\f', '\r', ' ', 0x00A0, 0x1680,
	0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
	0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
}

func TestIsSpace(t *testing.T) {
	want := map[rune]bool{}
	for _, r := range jsSpaces {
		want[r] = true
	}
	for r := rune(0); r <= utf8.MaxRune; r++ {
		if got := IsSpace(r); got != want[r] {
			t.Errorf("IsSpace(%U) = %v, want %v", r, got, want[r])
		}
	}
	for _, r := range []rune{0x0085, 0x180E, 0x200B, 'a', 0} {
		if IsSpace(r) {
			t.Errorf("IsSpace(%U) = true, want false", r)
		}
	}
}

func TestTrim(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"  a b  ", "a b"},
		{"\uFEFF\u3000alice\u2028\t", "alice"},
		{"\u0085alice\u200B", "\u0085alice\u200B"},
		{"\u180Ex", "\u180Ex"},
		{string(jsSpaces), ""},
	}
	for _, c := range cases {
		if got := Trim(c.in); got != c.want {
			t.Errorf("Trim(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestLen(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"abc", 3},
		{"あいう", 3},
		{"\U0001F600", 2},
		{strings.Repeat("\U0001F600", 6), 12},
		{"a\U0001F600b", 4},
		{"\xff", 1},
	}
	for _, c := range cases {
		if got := Len(c.in); got != c.want {
			t.Errorf("Len(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestTruncate(t *testing.T) {
	cases := []struct {
		in   string
		n    int
		want string
	}{
		{"abc", 5, "abc"},
		{"abc", 2, "ab"},
		{"abc", 0, ""},
		{"あいう", 2, "あい"},
		{"a\U0001F600b", 3, "a\U0001F600"},
		{"a\U0001F600b", 2, "a\uFFFD"}, // half a surrogate pair
		{"a\U0001F600b", 1, "a"},
		{"\U0001F600\U0001F600", 4, "\U0001F600\U0001F600"},
	}
	for _, c := range cases {
		if got := Truncate(c.in, c.n); got != c.want {
			t.Errorf("Truncate(%q, %d) = %q, want %q", c.in, c.n, got, c.want)
		}
	}
}

func TestToLower(t *testing.T) {
	cases := []struct{ in, want string }{
		{"ALICE", "alice"},
		{"\u0130abc", "i\u0307abc"},
		{"A\u0130B\u0130", "ai\u0307bi\u0307"},
		{"\u212Aabc", "kabc"}, // Kelvin sign
		{"\u00C4\u00D6\u00DC", "\u00E4\u00F6\u00FC"},
	}
	for _, c := range cases {
		if got := ToLower(c.in); got != c.want {
			t.Errorf("ToLower(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
