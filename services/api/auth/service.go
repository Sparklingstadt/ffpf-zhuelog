package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	maxPasswordRunes  = 128
	refreshTokenBytes = 32
	familyIDBytes     = 16
)

// ChangePassword's outcomes besides ErrForbidden and infrastructure errors.
var (
	// ErrInvalidNewPassword: the new password is not 12 to 128 UTF-16 units.
	ErrInvalidNewPassword = errors.New("auth: new password must be 12 to 128 characters")
	// ErrPasswordMismatch: the new password and its confirmation differ.
	ErrPasswordMismatch = errors.New("auth: password confirmation does not match")
	// ErrInvalidCurrentPassword covers a missing account, a malformed or wrong
	// current password and a lockout alike, so they cannot be told apart.
	ErrInvalidCurrentPassword = errors.New("auth: current password is wrong or the account is locked")
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

// LoginGitHub signs in an allowlisted GitHub user as an admin.
func (s *Service) LoginGitHub(ctx context.Context, code, verifier, redirectURI string) (TokenPair, error) {
	user, err := s.GitHub.Exchange(ctx, code, verifier, redirectURI)
	if err != nil {
		return TokenPair{}, err
	}
	if !s.Allowlist.Allows(user.Login) {
		return TokenPair{}, ErrForbidden
	}
	return s.startSession(ctx, Principal{
		OwnerID: strconv.FormatInt(user.ID, 10),
		Role:    RoleAdmin,
		Login:   user.Login,
	})
}

// LoginPassword signs in a member. Every credential failure (malformed input,
// unknown loginId, lockout, wrong password) returns ErrUnauthorized after
// exactly one password-hash computation, so they are indistinguishable. If the
// hash cannot be computed (ctx done while waiting), the hasher's error is
// returned wrapped instead.
func (s *Service) LoginPassword(ctx context.Context, loginID, password string) (TokenPair, error) {
	loginID, validID := NormalizeLoginID(loginID)
	if !validID || password == "" || utf8.RuneCountInString(password) > maxPasswordRunes {
		return TokenPair{}, s.rejectPassword(ctx, truncateRunes(password, maxPasswordRunes))
	}

	account, err := s.Store.FindPasswordAccountByLoginID(ctx, loginID)
	if errors.Is(err, store.ErrNotFound) {
		return TokenPair{}, s.rejectPassword(ctx, password)
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: find password account: %w", err)
	}

	reserved, err := s.Store.ReserveAttempt(ctx, account.ID, s.now())
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: reserve attempt: %w", err)
	}
	if !reserved {
		return TokenPair{}, s.rejectPassword(ctx, password)
	}
	ok, err := s.Passwords.Verify(ctx, password, account.PasswordHash)
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: verify password: %w", err)
	}
	if !ok {
		return TokenPair{}, ErrUnauthorized
	}
	if err := s.Store.ClearFailures(ctx, account.ID, s.now()); err != nil {
		return TokenPair{}, fmt.Errorf("auth: clear failures: %w", err)
	}

	return s.startSession(ctx, Principal{
		OwnerID:        store.MemberOwnerID(account.ID),
		Role:           RoleMember,
		SessionVersion: account.SessionVersion,
	})
}

// rejectPassword spends one simulated hash computation and returns
// ErrUnauthorized, or the hasher's error if it could not compute.
func (s *Service) rejectPassword(ctx context.Context, password string) error {
	if err := s.Passwords.Simulate(ctx, password); err != nil {
		return fmt.Errorf("auth: simulate password: %w", err)
	}
	return ErrUnauthorized
}

// ChangePassword lets a member replace their own password, in the web app's
// ChangeOwnPassword order:
//
//  1. only members may (ErrForbidden), checked before anything else;
//  2. next must be 12 to 128 UTF-16 units, spaces included
//     (ErrInvalidNewPassword);
//  3. confirm must equal next (ErrPasswordMismatch);
//  4. a missing account, a current password that is not 1 to 128 runes, a
//     lockout or a wrong password all return ErrInvalidCurrentPassword after
//     exactly one password-hash computation. An attempt is counted
//     (ReserveAttempt) for an existing account before current is checked.
//
// Steps 1 to 3 count no attempt and compute no hash. On success the new hash
// is stored with SetPassword, which bumps the session version (revoking every
// existing session, this one included) and clears the failures and the lock.
func (s *Service) ChangePassword(ctx context.Context, p Principal, current, next, confirm string) error {
	if p.Role != RoleMember {
		return ErrForbidden
	}
	if !ValidNewPassword(next) {
		return ErrInvalidNewPassword
	}
	if next != confirm {
		return ErrPasswordMismatch
	}

	// Simulate never sees more than maxPasswordRunes runes.
	simulated := truncateRunes(current, maxPasswordRunes)
	accountID, ok := strings.CutPrefix(p.OwnerID, store.MemberOwnerPrefix)
	if !ok || accountID == "" {
		return s.rejectCurrent(ctx, simulated)
	}
	account, err := s.Store.FindPasswordAccountByID(ctx, accountID)
	if errors.Is(err, store.ErrNotFound) {
		return s.rejectCurrent(ctx, simulated)
	}
	if err != nil {
		return fmt.Errorf("auth: find password account: %w", err)
	}

	reserved, err := s.Store.ReserveAttempt(ctx, account.ID, s.now())
	if err != nil {
		return fmt.Errorf("auth: reserve attempt: %w", err)
	}
	if !reserved || current == "" || utf8.RuneCountInString(current) > maxPasswordRunes {
		return s.rejectCurrent(ctx, simulated)
	}
	match, err := s.Passwords.Verify(ctx, current, account.PasswordHash)
	if err != nil {
		return fmt.Errorf("auth: verify password: %w", err)
	}
	if !match {
		return ErrInvalidCurrentPassword
	}

	hash, err := s.Passwords.Hash(ctx, next)
	if err != nil {
		return fmt.Errorf("auth: hash password: %w", err)
	}
	err = s.Store.SetPassword(ctx, account.ID, hash, s.now())
	if errors.Is(err, store.ErrNotFound) {
		// The account was deleted after the current password was checked.
		return ErrInvalidCurrentPassword
	}
	if err != nil {
		return fmt.Errorf("auth: set password: %w", err)
	}
	return nil
}

// rejectCurrent spends one simulated hash computation and returns
// ErrInvalidCurrentPassword, or the hasher's error if it could not compute.
func (s *Service) rejectCurrent(ctx context.Context, password string) error {
	if err := s.Passwords.Simulate(ctx, password); err != nil {
		return fmt.Errorf("auth: simulate password: %w", err)
	}
	return ErrInvalidCurrentPassword
}

// Refresh rotates a refresh token. Presenting an already-rotated token revokes
// its whole family (token theft); so does failing the revocation check or
// losing a concurrent rotation.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (TokenPair, error) {
	if refreshToken == "" {
		return TokenPair{}, ErrUnauthorized
	}
	now := s.now()
	row, err := s.Store.FindRefreshToken(ctx, hashRefreshToken(refreshToken))
	if errors.Is(err, store.ErrNotFound) {
		return TokenPair{}, ErrUnauthorized
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: find refresh token: %w", err)
	}
	if row.RevokedAt != nil {
		return TokenPair{}, s.revokeFamily(ctx, row.FamilyID, now, ErrUnauthorized)
	}
	if !row.ExpiresAt.After(now) {
		return TokenPair{}, ErrUnauthorized
	}

	p, err := principalFromRow(row)
	if err != nil {
		return TokenPair{}, s.revokeFamily(ctx, row.FamilyID, now, err)
	}
	if err := s.checkCurrent(ctx, p); err != nil {
		if errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrForbidden) {
			return TokenPair{}, s.revokeFamily(ctx, row.FamilyID, now, err)
		}
		return TokenPair{}, err
	}

	pair, next, nextHash, err := s.newPair(p, row.FamilyID, now)
	if err != nil {
		return TokenPair{}, err
	}
	rotated, err := s.Store.RotateRefreshToken(ctx, row.ID, next, nextHash, now)
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: rotate refresh token: %w", err)
	}
	if !rotated {
		return TokenPair{}, s.revokeFamily(ctx, row.FamilyID, now, ErrUnauthorized)
	}
	return pair, nil
}

// Logout revokes the refresh token's family. Unknown and empty tokens are not
// an error.
func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	row, err := s.Store.FindRefreshToken(ctx, hashRefreshToken(refreshToken))
	if errors.Is(err, store.ErrNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("auth: find refresh token: %w", err)
	}
	if err := s.Store.RevokeFamily(ctx, row.FamilyID, s.now()); err != nil {
		return fmt.Errorf("auth: revoke family: %w", err)
	}
	return nil
}

// Authenticate verifies an access token and checks that its holder is still
// allowed: admins must still be allowlisted (else ErrForbidden) and members'
// session version must still match (else ErrUnauthorized).
func (s *Service) Authenticate(ctx context.Context, accessToken string) (Principal, error) {
	p, err := s.Signer.Verify(accessToken)
	if err != nil {
		return Principal{}, ErrUnauthorized
	}
	if err := s.checkCurrent(ctx, p); err != nil {
		return Principal{}, err
	}
	return p, nil
}

// checkCurrent is the revocation check shared by Refresh and Authenticate.
func (s *Service) checkCurrent(ctx context.Context, p Principal) error {
	switch p.Role {
	case RoleAdmin:
		if !s.Allowlist.Allows(p.Login) {
			return ErrForbidden
		}
		return nil
	case RoleMember:
		accountID, ok := strings.CutPrefix(p.OwnerID, store.MemberOwnerPrefix)
		if !ok || accountID == "" {
			return ErrUnauthorized
		}
		current, err := s.Store.SessionVersion(ctx, accountID)
		if errors.Is(err, store.ErrNotFound) {
			return ErrUnauthorized
		}
		if err != nil {
			return fmt.Errorf("auth: session version: %w", err)
		}
		if current != p.SessionVersion {
			return ErrUnauthorized
		}
		return nil
	default:
		return ErrUnauthorized
	}
}

// revokeFamily revokes familyID and returns cause, or the store error if the
// revocation itself failed.
func (s *Service) revokeFamily(ctx context.Context, familyID string, now time.Time, cause error) error {
	if err := s.Store.RevokeFamily(ctx, familyID, now); err != nil {
		return fmt.Errorf("auth: revoke family: %w", err)
	}
	return cause
}

// startSession prunes the owner's dead refresh tokens and issues a pair in a
// new family.
func (s *Service) startSession(ctx context.Context, p Principal) (TokenPair, error) {
	now := s.now()
	if err := s.Store.PruneRefreshTokens(ctx, p.OwnerID, now); err != nil {
		return TokenPair{}, fmt.Errorf("auth: prune refresh tokens: %w", err)
	}
	pair, row, hash, err := s.newPair(p, randomHex(familyIDBytes), now)
	if err != nil {
		return TokenPair{}, err
	}
	if err := s.Store.InsertRefreshToken(ctx, row, hash); err != nil {
		return TokenPair{}, fmt.Errorf("auth: insert refresh token: %w", err)
	}
	return pair, nil
}

// newPair issues an access token and a fresh refresh token, and returns the
// row (without ID; the store assigns one) and hash to store for it.
func (s *Service) newPair(p Principal, familyID string, now time.Time) (TokenPair, store.RefreshToken, string, error) {
	access, err := s.Signer.Issue(p)
	if err != nil {
		return TokenPair{}, store.RefreshToken{}, "", err
	}
	refresh := base64.RawURLEncoding.EncodeToString(randomBytes(refreshTokenBytes))
	row := store.RefreshToken{
		OwnerID:   p.OwnerID,
		Role:      p.Role,
		FamilyID:  familyID,
		ExpiresAt: now.Add(RefreshTTL),
	}
	switch p.Role {
	case RoleAdmin:
		row.Login = p.Login
	case RoleMember:
		sv := p.SessionVersion
		row.SessionVersion = &sv
	}
	pair := TokenPair{AccessToken: access, RefreshToken: refresh, ExpiresIn: int(AccessTTL / time.Second)}
	return pair, row, hashRefreshToken(refresh), nil
}

// principalFromRow rebuilds the principal a refresh-token row was issued for.
func principalFromRow(row store.RefreshToken) (Principal, error) {
	switch row.Role {
	case RoleAdmin:
		return Principal{OwnerID: row.OwnerID, Role: RoleAdmin, Login: row.Login}, nil
	case RoleMember:
		if row.SessionVersion == nil {
			return Principal{}, ErrUnauthorized
		}
		return Principal{OwnerID: row.OwnerID, Role: RoleMember, SessionVersion: *row.SessionVersion}, nil
	default:
		return Principal{}, ErrUnauthorized
	}
}

func hashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
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
