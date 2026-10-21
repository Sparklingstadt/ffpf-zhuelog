package auth

import "testing"

func TestAllowlist(t *testing.T) {
	a := ParseAllowlist(" 42, 1001 ,,octocat, -7, 12a, 3.0, ")
	if len(a) != 2 {
		t.Fatalf("len = %d, want 2 (%v)", len(a), a)
	}
	for _, id := range []string{"42", "1001"} {
		if !a.Allows(id) {
			t.Errorf("Allows(%q) = false", id)
		}
	}
	for _, id := range []string{"", "  ", " 42", "42 ", "042", "+42", "octocat", "-7", "12a", "43"} {
		if a.Allows(id) {
			t.Errorf("Allows(%q) = true", id)
		}
	}
	if ParseAllowlist("").Allows("") {
		t.Error("empty allowlist allows empty id")
	}
	if ParseAllowlist("alice,bob").Allows("alice") {
		t.Error("login names must not be accepted as entries")
	}
	var nilList Allowlist
	if nilList.Allows("42") {
		t.Error("nil allowlist allows id")
	}
}
