package auth

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
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

// ChangePassword lets a member replace their own password, in the web app's
// ChangeOwnPassword order:
//
//  1. only members may (ErrForbidden), checked before anything else;
//  2. next must be 12 to 128 UTF-16 units, spaces included
//     (ErrInvalidNewPassword);
//  3. confirm must equal next (ErrPasswordMismatch);
//  4. a missing account, a current password that is not 1 to 128 runes, too
//     many recent tries or a wrong password all return
//     ErrInvalidCurrentPassword after exactly one password-hash computation.
//     For an existing account an attempt is counted against the
//     "password-change:<accountId>" throttle key (maxFailuresPerLogin per
//     throttleWindow, like the web) before current is checked. Only the
//     signed-in member reaches that key, and it never blocks sign-in.
//
// Steps 1 to 3 count no attempt and compute no hash. On success the new hash
// is stored with SetPassword, which bumps the session version (revoking every
// existing session, this one included), and the throttle key is reset.
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
	accountID, ok := memberAccountID(p)
	if !ok {
		return s.reject(ctx, simulated, ErrInvalidCurrentPassword)
	}
	account, err := s.Store.FindPasswordAccountByID(ctx, accountID)
	if errors.Is(err, store.ErrNotFound) {
		return s.reject(ctx, simulated, ErrInvalidCurrentPassword)
	}
	if err != nil {
		return fmt.Errorf("auth: find password account: %w", err)
	}

	key := "password-change:" + account.ID
	allowed, err := s.Store.ConsumeThrottle(ctx, key, maxFailuresPerLogin, throttleWindow, s.now())
	if err != nil {
		return fmt.Errorf("auth: consume throttle: %w", err)
	}
	if !allowed || current == "" || utf8.RuneCountInString(current) > maxPasswordRunes {
		return s.reject(ctx, simulated, ErrInvalidCurrentPassword)
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
	if err := s.Store.ResetThrottle(ctx, key); err != nil {
		return fmt.Errorf("auth: reset throttle: %w", err)
	}
	return nil
}
