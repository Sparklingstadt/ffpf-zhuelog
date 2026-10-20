package auth

import (
	"os"
	"strings"
	"testing"
)

func nodeHash(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("testdata/node_scrypt_hash.txt")
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(b))
}

func TestVerifyNodeHash(t *testing.T) {
	var v PasswordVerifier
	hash := nodeHash(t)
	if !v.Verify("correct horse battery", hash) {
		t.Fatal("correct password rejected")
	}
	if v.Verify("wrong", hash) {
		t.Fatal("wrong password accepted")
	}
}

func TestVerifyRejectsBadHashes(t *testing.T) {
	var v PasswordVerifier
	parts := strings.Split(nodeHash(t), ":")
	if len(parts) != 6 {
		t.Fatalf("fixture has %d parts", len(parts))
	}
	build := func(mut func(p []string)) string {
		p := append([]string(nil), parts...)
		mut(p)
		return strings.Join(p, ":")
	}

	cases := map[string]string{
		"too few parts":     strings.Join(parts[:5], ":"),
		"too many parts":    nodeHash(t) + ":x",
		"bcrypt prefix":     build(func(p []string) { p[0] = "bcrypt" }),
		"N=65536":           build(func(p []string) { p[1] = "65536" }),
		"N=3":               build(func(p []string) { p[1] = "3" }),
		"N=1":               build(func(p []string) { p[1] = "1" }),
		"N=0":               build(func(p []string) { p[1] = "0" }),
		"N non-digit":       build(func(p []string) { p[1] = "3x" }),
		"N 10 digits":       build(func(p []string) { p[1] = "1000000000" }),
		"r=9":               build(func(p []string) { p[2] = "9" }),
		"r=0":               build(func(p []string) { p[2] = "0" }),
		"p=5":               build(func(p []string) { p[3] = "5" }),
		"p=0":               build(func(p []string) { p[3] = "0" }),
		"p signed":          build(func(p []string) { p[3] = "+1" }),
		"key 32 bytes":      build(func(p []string) { p[5] = p[5][:43] }),
		"key trailing =":    build(func(p []string) { p[5] += "=" }),
		"key non-canonical": build(func(p []string) { p[5] = p[5][:len(p[5])-1] + "B" }),
		"salt empty":        build(func(p []string) { p[4] = "" }),
		"salt trailing =":   build(func(p []string) { p[4] += "=" }),
		"salt invalid char": build(func(p []string) { p[4] = "!!!!" }),
		"empty hash":        "",
	}
	for name, hash := range cases {
		t.Run(name, func(t *testing.T) {
			if v.Verify("correct horse battery", hash) {
				t.Fatal("accepted")
			}
		})
	}
}

func TestVerifyTamperedKeyIsFalse(t *testing.T) {
	var v PasswordVerifier
	parts := strings.Split(nodeHash(t), ":")
	// Flip a canonical key into a different canonical key: scrypt succeeds, compare fails.
	k := []byte(parts[5])
	if k[0] == 'A' {
		k[0] = 'B'
	} else {
		k[0] = 'A'
	}
	parts[5] = string(k)
	if v.Verify("correct horse battery", strings.Join(parts, ":")) {
		t.Fatal("tampered key accepted")
	}
}

func TestSimulateDoesNotPanic(t *testing.T) {
	var v PasswordVerifier
	v.Simulate("x")
	v.Simulate("x")
}
