package auth

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

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
		return TokenPair{}, s.reject(ctx, truncateRunes(password, maxPasswordRunes), ErrUnauthorized)
	}

	account, err := s.Store.FindPasswordAccountByLoginID(ctx, loginID)
	if errors.Is(err, store.ErrNotFound) {
		return TokenPair{}, s.reject(ctx, password, ErrUnauthorized)
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: find password account: %w", err)
	}

	reserved, err := s.Store.ReserveAttempt(ctx, account.ID, s.now())
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: reserve attempt: %w", err)
	}
	if !reserved {
		return TokenPair{}, s.reject(ctx, password, ErrUnauthorized)
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
