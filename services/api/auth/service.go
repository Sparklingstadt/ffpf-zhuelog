package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	maxPasswordRunes  = 128
	refreshTokenBytes = 32
	familyIDBytes     = 16
)

var (
	_ Store  = (*store.Store)(nil)
	_ GitHub = (*GitHubClient)(nil)
	_ Hasher = (*PasswordVerifier)(nil)
)

// Store is the persistence the Service needs; *store.Store satisfies it.
type Store interface {
	FindPasswordAccountByLoginID(ctx context.Context, loginID string) (store.PasswordAccount, error)
	FindPasswordAccountByID(ctx context.Context, id string) (store.PasswordAccount, error)
	SetPassword(ctx context.Context, id, hash string, now time.Time) error
	SessionVersion(ctx context.Context, accountID string) (int, error)
	ReserveAttempt(ctx context.Context, accountID string, now time.Time) (bool, error)
	ClearFailures(ctx context.Context, accountID string, now time.Time) error
	InsertRefreshToken(ctx context.Context, t store.RefreshToken, tokenHash string) error
	FindRefreshToken(ctx context.Context, tokenHash string) (store.RefreshToken, error)
	RotateRefreshToken(ctx context.Context, oldID string, next store.RefreshToken, nextHash string, now time.Time) (bool, error)
	RevokeFamily(ctx context.Context, familyID string, now time.Time) error
	PruneRefreshTokens(ctx context.Context, ownerID string, now time.Time) error
}

// GitHub exchanges an OAuth code for the GitHub user; *GitHubClient satisfies it.
type GitHub interface {
	Exchange(ctx context.Context, code, verifier, redirectURI string) (GitHubUser, error)
}

// Hasher checks and hashes passwords; *PasswordVerifier satisfies it. Errors
// mean the computation did not run (for example ctx was done while waiting for
// a slot); a wrong password or malformed hash is (false, nil).
type Hasher interface {
	Verify(ctx context.Context, password, hash string) (bool, error)
	Simulate(ctx context.Context, password string) error
	Hash(ctx context.Context, password string) (string, error)
}

// TokenPair is what a login or refresh returns. ExpiresIn is the access
// token's lifetime in seconds.
type TokenPair struct {
	AccessToken, RefreshToken string
	ExpiresIn                 int
}

// Service runs sign-in, refresh-token rotation, logout, the per-request
// revocation check, and members' own password changes. Errors are
// ErrUnauthorized, ErrForbidden, the GitHub client's sentinels, ChangePassword's
// sentinels, or (for store failures) other errors; none of them contain
// tokens, hashes, codes or passwords.
type Service struct {
	Store     Store
	Signer    *Signer
	GitHub    GitHub
	Allowlist Allowlist
	Passwords Hasher
	Now       func() time.Time // nil means time.Now
}

func (s *Service) now() time.Time {
	if s.Now == nil {
		return time.Now()
	}
	return s.Now()
}

// memberAccountID returns the password account ID a member principal's owner
// ID refers to, or false if p.OwnerID is not a non-empty member owner ID.
func memberAccountID(p Principal) (string, bool) {
	id, ok := strings.CutPrefix(p.OwnerID, store.MemberOwnerPrefix)
	return id, ok && id != ""
}

// reject spends one simulated hash computation and returns sentinel, or the
// hasher's error if it could not compute.
func (s *Service) reject(ctx context.Context, password string, sentinel error) error {
	if err := s.Passwords.Simulate(ctx, password); err != nil {
		return fmt.Errorf("auth: simulate password: %w", err)
	}
	return sentinel
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	// crypto/rand.Read never returns an error on supported platforms.
	_, _ = rand.Read(b)
	return b
}

func randomHex(n int) string { return hex.EncodeToString(randomBytes(n)) }

// truncateRunes returns the first limit runes of s.
func truncateRunes(s string, limit int) string {
	n := 0
	for i := range s {
		if n == limit {
			return s[:i]
		}
		n++
	}
	return s
}
