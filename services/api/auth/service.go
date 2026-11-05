package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
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

// Sign-in throttling, counted in the SignInThrottle table. These constants
// are the only source of the limits. Keys always include the client address,
// so nobody can lock a member out from elsewhere.
const (
	throttleWindow       = 15 * time.Minute
	maxAttemptsPerClient = 20 // every password sign-in attempt from one client
	maxFailuresPerLogin  = 5  // attempts per client and loginId, reset on success
)

// ErrThrottled means the client made too many sign-in attempts recently.
var ErrThrottled = errors.New("auth: too many sign-in attempts")

// ErrFFPFDisabled means FFPF ID logins are not configured (Service.FFPF is nil).
var ErrFFPFDisabled = errors.New("auth: ffpf id logins are disabled")

// maxDisplayNameRunes is the longest display name kept for an FFPF ID member,
// as for password members.
const maxDisplayNameRunes = 50

var (
	_ Store  = (*store.Store)(nil)
	_ GitHub = (*GitHubClient)(nil)
	_ FFPF   = (*FFPFClient)(nil)
	_ Hasher = (*PasswordVerifier)(nil)
)

// Store is the persistence the Service needs; *store.Store satisfies it.
type Store interface {
	FindPasswordAccountByLoginID(ctx context.Context, loginID string) (store.PasswordAccount, error)
	FindPasswordAccountByID(ctx context.Context, id string) (store.PasswordAccount, error)
	SetPassword(ctx context.Context, id, hash string, now time.Time) error
	SessionVersion(ctx context.Context, accountID string) (int, error)
	ConsumeThrottle(ctx context.Context, key string, limit int, window time.Duration, now time.Time) (bool, error)
	ResetThrottle(ctx context.Context, key string) error
	InsertRefreshToken(ctx context.Context, t store.RefreshToken, tokenHash string) error
	FindRefreshToken(ctx context.Context, tokenHash string) (store.RefreshToken, error)
	RotateRefreshToken(ctx context.Context, oldID string, next store.RefreshToken, nextHash string, now time.Time) (bool, error)
	RevokeFamily(ctx context.Context, familyID string, now time.Time) error
	InsertSiblingIfFamilyActive(ctx context.Context, next store.RefreshToken, nextHash string, now time.Time) (bool, error)
	PruneRefreshTokens(ctx context.Context, ownerID string, now time.Time) error
	DeleteExpiredRefreshTokens(ctx context.Context, ownerID string, now time.Time) error
	UpsertFfpfAccount(ctx context.Context, a store.FfpfAccount, now time.Time) (store.FfpfAccount, error)
	FindFfpfAccount(ctx context.Context, id string) (store.FfpfAccount, error)
	FfpfSessionVersion(ctx context.Context, id string) (int, error)
}

// GitHub exchanges an OAuth code for the GitHub user; *GitHubClient satisfies it.
type GitHub interface {
	Exchange(ctx context.Context, code, verifier, redirectURI string) (GitHubUser, error)
}

// FFPF exchanges an FFPF ID authorization code for the user its verified ID
// token names; *FFPFClient satisfies it.
type FFPF interface {
	Exchange(ctx context.Context, code, verifier, redirectURI, nonce string) (FFPFUser, error)
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
// token's lifetime in seconds and RefreshExpiresIn the refresh token's.
type TokenPair struct {
	AccessToken, RefreshToken string
	ExpiresIn                 int
	RefreshExpiresIn          int
}

// Service runs sign-in, refresh-token rotation, logout, the per-request
// revocation check, and members' own password changes. Errors are
// ErrUnauthorized, ErrForbidden, ErrThrottled, ErrFFPFDisabled, the GitHub and
// FFPF ID clients' sentinels, ChangePassword's sentinels, or (for store
// failures) other errors; none of them contain tokens, hashes, codes or
// passwords.
type Service struct {
	Store     Store
	Signer    *Signer
	GitHub    GitHub
	FFPF      FFPF // nil when FFPF ID is not configured (ErrFFPFDisabled)
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

// ffpfAccountID returns the FFPF ID sub an FFPF ID member principal's owner
// ID refers to, or false if p.OwnerID is not a non-empty ffpf: owner ID.
func ffpfAccountID(p Principal) (string, bool) {
	id, ok := strings.CutPrefix(p.OwnerID, store.FfpfOwnerPrefix)
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

// consumeThrottle counts one attempt against key and returns ErrThrottled
// when it is over limit.
func (s *Service) consumeThrottle(ctx context.Context, key string, limit int, now time.Time) error {
	allowed, err := s.Store.ConsumeThrottle(ctx, key, limit, throttleWindow, now)
	if err != nil {
		return fmt.Errorf("auth: consume throttle: %w", err)
	}
	if !allowed {
		return ErrThrottled
	}
	return nil
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
