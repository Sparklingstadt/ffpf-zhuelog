package auth

import "testing"

func TestAllowlist(t *testing.T) {
	a := ParseAllowlist(" Alice, bob ,,")
	if len(a) != 2 {
		t.Fatalf("len = %d, want 2", len(a))
	}
	for _, login := range []string{"alice", " BOB ", "Alice"} {
		if !a.Allows(login) {
			t.Errorf("Allows(%q) = false", login)
		}
	}
	for _, login := range []string{"", "  ", "carol"} {
		if a.Allows(login) {
			t.Errorf("Allows(%q) = true", login)
		}
	}
	if ParseAllowlist("").Allows("") {
		t.Error("empty allowlist allows empty login")
	}
	var nilList Allowlist
	if nilList.Allows("alice") {
		t.Error("nil allowlist allows login")
	}
}
