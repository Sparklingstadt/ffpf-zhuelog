package auth

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
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

// LoginFFPF signs in an FFPF ID user as a member: it exchanges the code (see
// FFPFClient.Exchange for the arguments and its errors), records the account
// with the current email and display name, and starts a session for the owner
// ID ffpf:<sub> (ErrUnauthorized when the sub cannot form one). Anyone with a
// verified FFPF ID account may sign in; there is no allowlist. The email is
// recorded for display only. It returns ErrFFPFDisabled when FFPF ID is not
// configured.
func (s *Service) LoginFFPF(ctx context.Context, code, verifier, redirectURI, nonce string) (TokenPair, error) {
	if s.FFPF == nil {
		return TokenPair{}, ErrFFPFDisabled
	}
	user, err := s.FFPF.Exchange(ctx, code, verifier, redirectURI, nonce)
	if err != nil {
		return TokenPair{}, err
	}
	// FFPFClient already checks the sub; check again so no FFPF implementation
	// can make a malformed owner ID.
	if !ffpfSub.MatchString(user.Sub) {
		return TokenPair{}, ErrUnauthorized
	}
	name := truncateRunes(strings.TrimSpace(user.Name), maxDisplayNameRunes)
	if name == "" {
		name, _, _ = strings.Cut(user.Email, "@")
		name = truncateRunes(name, maxDisplayNameRunes)
	}
	acc, err := s.Store.UpsertFfpfAccount(ctx, store.FfpfAccount{ID: user.Sub, Email: user.Email, DisplayName: name}, s.now())
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: upsert ffpf account: %w", err)
	}
	return s.startSession(ctx, Principal{
		OwnerID:        store.FfpfOwnerID(acc.ID),
		Role:           RoleMember,
		Login:          user.Email,
		SessionVersion: acc.SessionVersion,
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

// LoginGuest starts a guest session. Guests need no credentials: they own no
// data and can only call the routes that allow guests.
func (s *Service) LoginGuest(ctx context.Context) (TokenPair, error) {
	return s.startSession(ctx, Principal{OwnerID: GuestOwnerID, Role: RoleGuest})
}
