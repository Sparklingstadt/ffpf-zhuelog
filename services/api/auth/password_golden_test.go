package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"flag"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/scrypt"
)

// The web writes every password hash (src/infrastructure/security/
// scrypt-password-hasher.ts) while Go still verifies them at sign-in. This file
// pins both to the same answers: Go writes fixed-salt hashes and its verdicts
// on edge-case hashes to the golden file, and the web's test
// (tests/scrypt-password-hasher.test.ts) checks its hasher against it.
var update = flag.Bool("update", false, "rewrite the scrypt golden file the web's tests read")

const scryptGoldenPath = "../../../tests/fixtures/scrypt-golden.json"

type scryptGoldenFile struct {
	Params scryptGoldenParams `json:"params"`
	Hashes []scryptGoldenHash `json:"hashes"`
	Verify []scryptGoldenCase `json:"verify"`
}

type scryptGoldenParams struct {
	N              int `json:"n"`
	R              int `json:"r"`
	P              int `json:"p"`
	SaltBytes      int `json:"saltBytes"`
	KeyBytes       int `json:"keyBytes"`
	GeneratedBytes int `json:"generatedBytes"`
}

type scryptGoldenHash struct {
	Name     string `json:"name"`
	Password string `json:"password"`
	Salt     string `json:"salt"`
	Hash     string `json:"hash"`
}

type scryptGoldenCase struct {
	Name     string `json:"name"`
	Password string `json:"password"`
	Hash     string `json:"hash"`
	Match    bool   `json:"match"`
}

// goldenSalt is a fixed salt per case, so the hashes are reproducible.
func goldenSalt(name string) []byte {
	sum := sha256.Sum256([]byte("zhuelog-scrypt-golden:" + name))
	return sum[:scryptSaltBytes]
}

func goldenKey(t *testing.T, password string, salt []byte, n, r, p, keyLen int) []byte {
	t.Helper()
	key, err := scrypt.Key([]byte(password), salt, n, r, p, keyLen)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func scryptGoldenHashes(t *testing.T) []scryptGoldenHash {
	cases := []struct{ name, password string }{
		{"ascii", "correct horse battery"},
		{"spaces kept", " keep spaces 1"},
		{"japanese", "パスワードは十二文字以上"},
		{"emoji", "😀😀😀😀😀😀"},
		{"128 characters", strings.Repeat("a", 128)},
		// Passwords are not normalised, so these two hash differently.
		{"decomposed accent", "étude-password"},
		{"composed accent", "étude-password"},
		{"generated shape", "AbCdEfGhIjKlMnOpQrSt"},
	}
	var out []scryptGoldenHash
	for _, c := range cases {
		salt := goldenSalt(c.name)
		key := goldenKey(t, c.password, salt, scryptN, scryptR, scryptP, scryptKeyBytes)
		out = append(out, scryptGoldenHash{
			Name:     c.name,
			Password: c.password,
			Salt:     base64.RawURLEncoding.EncodeToString(salt),
			Hash:     formatScryptHash(salt, key),
		})
	}
	return out
}

// scryptGoldenCases are hashes around the edges of what parseScryptHash
// accepts, built from the ascii case's salt and key.
func scryptGoldenCases(t *testing.T, v *PasswordVerifier, ascii scryptGoldenHash) []scryptGoldenCase {
	const password = "correct horse battery"
	enc := base64.RawURLEncoding
	salt := goldenSalt(ascii.Name)
	key := goldenKey(t, password, salt, scryptN, scryptR, scryptP, scryptKeyBytes)
	s, k := enc.EncodeToString(salt), enc.EncodeToString(key)
	older := enc.EncodeToString(goldenKey(t, password, salt, 16384, 8, 2, scryptKeyBytes))
	tampered := "A"
	if k[0] == 'A' {
		tampered = "B"
	}
	tampered += k[1:]

	cases := []struct{ name, password, hash string }{
		{"wrong password", "correct horse batterY", ascii.Hash},
		{"older parameters", password, "scrypt:16384:8:2:" + s + ":" + older},
		{"leading zeros in N", password, "scrypt:032768:8:1:" + s + ":" + k},
		{"N above 32768", password, "scrypt:65536:8:1:" + s + ":" + k},
		{"N not a power of two", password, "scrypt:3:8:1:" + s + ":" + k},
		{"r above 8", password, "scrypt:32768:9:1:" + s + ":" + k},
		{"p above 4", password, "scrypt:32768:8:5:" + s + ":" + k},
		{"p zero", password, "scrypt:32768:8:0:" + s + ":" + k},
		{"padded salt", password, "scrypt:32768:8:1:" + s + "==:" + k},
		{"salt with a foreign character", password, "scrypt:32768:8:1:" + s + "!:" + k},
		{"empty salt", password, "scrypt:32768:8:1::" + k},
		{"short key", password, "scrypt:32768:8:1:" + s + ":" + enc.EncodeToString(key[:63])},
		{"tampered key", password, "scrypt:32768:8:1:" + s + ":" + tampered},
		{"seven parts", password, ascii.Hash + ":x"},
		{"not scrypt", password, "bcrypt$2b$10$abcdefghijklmnopqrstuv"},
		{"demo marker", password, "demo:no-password"},
	}
	var out []scryptGoldenCase
	for _, c := range cases {
		match, err := v.Verify(context.Background(), c.password, c.hash)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, scryptGoldenCase{Name: c.name, Password: c.password, Hash: c.hash, Match: match})
	}
	return out
}

func TestScryptGolden(t *testing.T) {
	v := &PasswordVerifier{}
	hashes := scryptGoldenHashes(t)
	for _, h := range hashes {
		if ok, err := v.Verify(context.Background(), h.Password, h.Hash); !ok || err != nil {
			t.Fatalf("%s: Verify = %v, %v; want true", h.Name, ok, err)
		}
	}
	file := scryptGoldenFile{
		Params: scryptGoldenParams{
			N: scryptN, R: scryptR, P: scryptP,
			SaltBytes: scryptSaltBytes, KeyBytes: scryptKeyBytes, GeneratedBytes: generatedBytes,
		},
		Hashes: hashes,
		Verify: scryptGoldenCases(t, v, hashes[0]),
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	if *update {
		if err := os.WriteFile(scryptGoldenPath, data, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(scryptGoldenPath)
	if err != nil {
		t.Fatalf("%v (run go test ./auth -run TestScryptGolden -update)", err)
	}
	if !bytes.Equal(data, want) {
		t.Errorf("the scrypt hashes or verdicts no longer match %s; if the change is meant, run go test ./auth -run TestScryptGolden -update and check the web's tests", scryptGoldenPath)
	}
}
