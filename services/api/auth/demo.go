package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// ErrDemoDisabled means there is no demo to enter: Service.DemoLoginID is
// unset, or its account has not been made yet (the web's nightly reset makes it).
var ErrDemoDisabled = errors.New("auth: the demo account is disabled")

// DemoEnabled reports whether the demo account is configured.
func (s *Service) DemoEnabled() bool { return s.DemoLoginID != "" }

// LoginDemo starts a member session for the demo account, with no password:
// its data is shared by everyone who tries the demo and is reset every night.
// client is the caller's address as normalised by ClientAddress; sessions are
// throttled per client like password sign-ins (ErrThrottled).
func (s *Service) LoginDemo(ctx context.Context, client string) (TokenPair, error) {
	if !s.DemoEnabled() {
		return TokenPair{}, ErrDemoDisabled
	}
	if err := s.consumeThrottle(ctx, "demo:"+client, maxAttemptsPerClient, s.now()); err != nil {
		return TokenPair{}, err
	}
	account, err := s.Store.FindPasswordAccountByLoginID(ctx, s.DemoLoginID)
	if errors.Is(err, store.ErrNotFound) {
		return TokenPair{}, ErrDemoDisabled
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: find demo account: %w", err)
	}
	// Only the account the reset made, which has no usable password: if
	// DEMO_LOGIN_ID named a real member, this would let anyone into it.
	if account.PasswordHash != store.DemoPasswordHash {
		return TokenPair{}, ErrDemoDisabled
	}
	return s.startSession(ctx, Principal{
		OwnerID:        store.MemberOwnerID(account.ID),
		Role:           RoleMember,
		SessionVersion: account.SessionVersion,
	})
}

// isDemoAccount reports whether a is the demo account: the one DEMO_LOGIN_ID
// names, or any account the reset made (it has no usable password).
func (s *Service) isDemoAccount(a store.PasswordAccount) bool {
	return a.PasswordHash == store.DemoPasswordHash || (s.DemoEnabled() && a.LoginID == s.DemoLoginID)
}
