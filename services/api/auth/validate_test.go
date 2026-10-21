package auth

import (
	"strings"
	"testing"
)

func TestNormalizeLoginID(t *testing.T) {
	bom, nel, dotI, kelvin := string(rune(0xFEFF)), string(rune(0x0085)), string(rune(0x0130)), string(rune(0x212A))
	cases := []struct {
		in, want string
		ok       bool
	}{
		{"alice", "alice", true},
		{"  Alice.W_9-x ", "alice.w_9-x", true},
		{bom + "alice" + string(rune(0x3000)), "alice", true},
		{kelvin + "abc", "kabc", true},
		{"a.-", "a.-", true},
		{strings.Repeat("z", 32), strings.Repeat("z", 32), true},
		{nel + "alice", nel + "alice", false},
		{dotI + "abc", "i" + string(rune(0x0307)) + "abc", false},
		{"ab", "ab", false},
		{strings.Repeat("z", 33), strings.Repeat("z", 33), false},
		{"al ice", "al ice", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := NormalizeLoginID(c.in)
		if got != c.want || ok != c.ok {
			t.Errorf("NormalizeLoginID(%q) = %q, %v; want %q, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestValidNewPassword(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{"123456789012", true},
		{"12345678901", false},
		{strings.Repeat("a", 128), true},
		{strings.Repeat("a", 129), false},
		{strings.Repeat("あ", 12), true},
		{strings.Repeat("あ", 11), false},
		{strings.Repeat("😀", 6), true},   // 12 UTF-16 units
		{strings.Repeat("😀", 64), true},  // 128 units
		{strings.Repeat("😀", 65), false}, // 130 units
		{"   spaces   ", true},           // not trimmed
		{"", false},
	}
	for _, c := range cases {
		if got := ValidNewPassword(c.in); got != c.ok {
			t.Errorf("ValidNewPassword(%q) = %v, want %v", c.in, got, c.ok)
		}
	}
}

func TestValidDisplayName(t *testing.T) {
	cases := []struct {
		in, want string
		ok       bool
	}{
		{"  Alice  ", "Alice", true},
		{strings.Repeat("あ", 50), strings.Repeat("あ", 50), true},
		{strings.Repeat("あ", 51), strings.Repeat("あ", 51), false},
		{strings.Repeat("😀", 25), strings.Repeat("😀", 25), true},
		{strings.Repeat("😀", 26), strings.Repeat("😀", 26), false},
		{" \t" + string(rune(0x3000)), "", false},
		{"a\x00b", "a\x00b", false},
	}
	for _, c := range cases {
		got, ok := ValidDisplayName(c.in)
		if got != c.want || ok != c.ok {
			t.Errorf("ValidDisplayName(%q) = %q, %v; want %q, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}
