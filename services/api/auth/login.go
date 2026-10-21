package auth

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// LoginGitHub signs in a GitHub user whose numeric ID is allowlisted as an
// admin. The login is recorded in the tokens for information only; it is never
// used for authorization, because it can be renamed and re-registered.
func (s *Service) LoginGitHub(ctx context.Context, code, verifier, redirectURI string) (TokenPair, error) {
	user, err := s.GitHub.Exchange(ctx, code, verifier, redirectURI)
	if err != nil {
		return TokenPair{}, err
	}
	ownerID := strconv.FormatInt(user.ID, 10)
	if !s.Allowlist.Allows(ownerID) {
		return TokenPair{}, ErrForbidden
	}
	return s.startSession(ctx, Principal{
		OwnerID: ownerID,
		Role:    RoleAdmin,
		Login:   user.Login,
	})
}

// LoginPassword signs in a member. client is the caller's address as
// normalised by ClientAddress.
//
// Attempts are throttled per client (maxAttemptsPerClient) and per client and
// loginId (maxFailuresPerLogin), both checked before any password hashing so
// throttled attempts cost no scrypt work; they return ErrThrottled. Throttling
// never depends on whether the account exists, so it reveals nothing, and
// because every key includes the client address, failures from one client
// never block a member signing in from another.
//
// Every other credential failure (malformed input, unknown loginId, wrong
// password) returns ErrUnauthorized after exactly one password-hash
// computation, so they are indistinguishable. If the hash cannot be computed
// (ctx done while waiting), the hasher's error is returned wrapped instead.
func (s *Service) LoginPassword(ctx context.Context, client, loginID, password string) (TokenPair, error) {
	now := s.now()
	if err := s.consumeThrottle(ctx, "client:"+client, maxAttemptsPerClient, now); err != nil {
		return TokenPair{}, err
	}

	loginID, validID := NormalizeLoginID(loginID)
	if !validID || password == "" || utf8.RuneCountInString(password) > maxPasswordRunes {
		return TokenPair{}, s.reject(ctx, truncateRunes(password, maxPasswordRunes), ErrUnauthorized)
	}

	loginKey := "login:" + client + ":" + loginID
	if err := s.consumeThrottle(ctx, loginKey, maxFailuresPerLogin, now); err != nil {
		return TokenPair{}, err
	}

	account, err := s.Store.FindPasswordAccountByLoginID(ctx, loginID)
	if errors.Is(err, store.ErrNotFound) {
		return TokenPair{}, s.reject(ctx, password, ErrUnauthorized)
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: find password account: %w", err)
	}
	ok, err := s.Passwords.Verify(ctx, password, account.PasswordHash)
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: verify password: %w", err)
	}
	if !ok {
		return TokenPair{}, ErrUnauthorized
	}
	if err := s.Store.ResetThrottle(ctx, loginKey); err != nil {
		return TokenPair{}, fmt.Errorf("auth: reset throttle: %w", err)
	}

	return s.startSession(ctx, Principal{
		OwnerID:        store.MemberOwnerID(account.ID),
		Role:           RoleMember,
		SessionVersion: account.SessionVersion,
	})
}
