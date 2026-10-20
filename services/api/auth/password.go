package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/scrypt"
)

// These match the parameters the web app writes for new hashes
// (src/infrastructure/auth/scrypt-password-hasher.ts).
const (
	scryptN         = 1 << 15
	scryptR         = 8
	scryptP         = 1
	scryptMaxP      = 4
	scryptSaltBytes = 16
	scryptKeyBytes  = 64
	generatedBytes  = 15
)

// PasswordVerifier checks passwords against the web app's scrypt hashes. The
// zero value is ready to use.
type PasswordVerifier struct {
	dummyOnce sync.Once
	dummyHash string
}

type scryptHash struct {
	n, r, p   int
	salt, key []byte
}

func isPowerOfTwo(n int) bool { return n >= 2 && n&(n-1) == 0 }

func parseDigits(s string) (int, bool) {
	if len(s) < 1 || len(s) > 9 {
		return 0, false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
	}
	v, err := strconv.Atoi(s)
	return v, err == nil
}

// decodeCanonical decodes unpadded base64url and rejects any input that does
// not re-encode to itself.
func decodeCanonical(s string) ([]byte, bool) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil || base64.RawURLEncoding.EncodeToString(b) != s {
		return nil, false
	}
	return b, true
}

// parseScryptHash mirrors the web app's parse(): it rejects anything the web
// hasher could not have written or that would cost more than it writes.
func parseScryptHash(hash string) (scryptHash, bool) {
	parts := strings.Split(hash, ":")
	if len(parts) != 6 || parts[0] != "scrypt" {
		return scryptHash{}, false
	}
	n, okN := parseDigits(parts[1])
	r, okR := parseDigits(parts[2])
	p, okP := parseDigits(parts[3])
	if !okN || !okR || !okP {
		return scryptHash{}, false
	}
	if !isPowerOfTwo(n) || n > scryptN {
		return scryptHash{}, false
	}
	if r < 1 || r > scryptR || p < 1 || p > scryptMaxP {
		return scryptHash{}, false
	}
	salt, ok := decodeCanonical(parts[4])
	if !ok || len(salt) == 0 {
		return scryptHash{}, false
	}
	key, ok := decodeCanonical(parts[5])
	if !ok || len(key) != scryptKeyBytes {
		return scryptHash{}, false
	}
	return scryptHash{n: n, r: r, p: p, salt: salt, key: key}, true
}

// Verify reports whether password matches hash. Malformed hashes and any
// scrypt failure return false.
func (v *PasswordVerifier) Verify(password, hash string) bool {
	h, ok := parseScryptHash(hash)
	if !ok {
		return false
	}
	actual, err := scrypt.Key([]byte(password), h.salt, h.n, h.r, h.p, len(h.key))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(actual, h.key) == 1
}

// Simulate spends the same work as Verify on a valid hash, for unknown users.
func (v *PasswordVerifier) Simulate(password string) {
	v.dummyOnce.Do(func() {
		pw := make([]byte, generatedBytes)
		salt := make([]byte, scryptSaltBytes)
		// crypto/rand.Read never returns an error on supported platforms.
		_, _ = rand.Read(pw)
		_, _ = rand.Read(salt)
		key, err := scrypt.Key(pw, salt, scryptN, scryptR, scryptP, scryptKeyBytes)
		if err != nil {
			return
		}
		enc := base64.RawURLEncoding
		v.dummyHash = strings.Join([]string{
			"scrypt",
			strconv.Itoa(scryptN), strconv.Itoa(scryptR), strconv.Itoa(scryptP),
			enc.EncodeToString(salt), enc.EncodeToString(key),
		}, ":")
	})
	v.Verify(password, v.dummyHash)
}
