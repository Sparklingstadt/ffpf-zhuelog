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
