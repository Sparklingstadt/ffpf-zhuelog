package auth

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"errors"
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

	// maxConcurrentHashes bounds the scrypt computations running at once in a
	// PasswordVerifier. Each one allocates 128*N*r bytes (32 MiB for new
	// hashes), so unbounded parallel logins could exhaust the instance's memory.
	maxConcurrentHashes = 4
)

// PasswordVerifier checks passwords against the web app's scrypt hashes. The
// zero value is ready to use. At most maxConcurrentHashes Verify and Simulate
// computations run at once; the rest wait for a slot.
type PasswordVerifier struct {
	semOnce   sync.Once
	sem       chan struct{}
	dummyOnce sync.Once
	dummyHash string
	// deriveKey is scrypt.Key when nil; tests replace it.
	deriveKey func(password, salt []byte, N, r, p, keyLen int) ([]byte, error)
}

func (v *PasswordVerifier) derive(password, salt []byte, n, r, p, keyLen int) ([]byte, error) {
	if v.deriveKey != nil {
		return v.deriveKey(password, salt, n, r, p, keyLen)
	}
	return scrypt.Key(password, salt, n, r, p, keyLen)
}

// acquire waits for a hashing slot. It returns ctx's error if ctx is done
// first; otherwise the caller must call release.
func (v *PasswordVerifier) acquire(ctx context.Context) error {
	v.semOnce.Do(func() { v.sem = make(chan struct{}, maxConcurrentHashes) })
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case v.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (v *PasswordVerifier) release() { <-v.sem }

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
// scrypt failure return false with a nil error. The only error is ctx's, when
// it is done before a hashing slot frees up.
func (v *PasswordVerifier) Verify(ctx context.Context, password, hash string) (bool, error) {
	h, ok := parseScryptHash(hash)
	if !ok {
		return false, nil
	}
	if err := v.acquire(ctx); err != nil {
		return false, err
	}
	defer v.release()
	actual, err := v.derive([]byte(password), h.salt, h.n, h.r, h.p, len(h.key))
	if err != nil {
		return false, nil
	}
	return subtle.ConstantTimeCompare(actual, h.key) == 1, nil
}

// Simulate spends the same work as Verify on a valid hash, for unknown users.
// Like Verify, it returns an error only when ctx is done before a slot frees up.
func (v *PasswordVerifier) Simulate(ctx context.Context, password string) error {
	v.Warm()
	_, err := v.Verify(ctx, password, v.dummyHash)
	return err
}

// Warm builds the dummy hash Simulate verifies against. Call it at startup so
// the first unknown-user login is not slower than the rest; Simulate calls it
// too. It runs outside the concurrency bound and only once.
func (v *PasswordVerifier) Warm() {
	v.dummyOnce.Do(func() {
		pw := randomBytes(generatedBytes)
		salt := randomBytes(scryptSaltBytes)
		key, err := v.derive(pw, salt, scryptN, scryptR, scryptP, scryptKeyBytes)
		if err != nil {
			return
		}
		v.dummyHash = formatScryptHash(salt, key)
	})
}

// Hash returns a new scrypt hash of password in the web app's format,
// scrypt:32768:8:1:<16-byte salt>:<64-byte key> (unpadded base64url), with a
// fresh random salt. It shares the concurrency bound with Verify and Simulate
// and returns ctx's error if ctx is done before a slot frees up.
func (v *PasswordVerifier) Hash(ctx context.Context, password string) (string, error) {
	salt := randomBytes(scryptSaltBytes)
	if err := v.acquire(ctx); err != nil {
		return "", err
	}
	defer v.release()
	key, err := v.derive([]byte(password), salt, scryptN, scryptR, scryptP, scryptKeyBytes)
	if err != nil {
		return "", errors.New("auth: scrypt failed")
	}
	return formatScryptHash(salt, key), nil
}

// formatScryptHash encodes a hash written with the current parameters.
func formatScryptHash(salt, key []byte) string {
	enc := base64.RawURLEncoding
	return strings.Join([]string{
		"scrypt",
		strconv.Itoa(scryptN), strconv.Itoa(scryptR), strconv.Itoa(scryptP),
		enc.EncodeToString(salt), enc.EncodeToString(key),
	}, ":")
}

// GeneratePassword returns a random password: 15 random bytes as unpadded
// base64url (20 characters), like the web app's generate().
func GeneratePassword() string {
	return base64.RawURLEncoding.EncodeToString(randomBytes(generatedBytes))
}
