package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// guestLogin is the Login shown for guests.
const guestLogin = "guest"

// Me describes the signed-in caller. DisplayName is set for members only and
// AccountID for password members only; an FFPF ID member's Login is their
// email address. ActingAs is set while an admin acts as a member.
type Me struct {
	OwnerID, Role, Login, DisplayName, AccountID string
	ActingAs                                     ActingAs
}

// ActingAs is the member an admin acts as. The zero value means none.
type ActingAs struct {
	OwnerID, LoginID, DisplayName string
}

// ActAs returns p acting as the member ownerID: the member's OwnerID with the
// admin's role and login, and the admin's own ID in ActorID. Only admins may
// act, and only as an existing member (store.ErrNotFound otherwise).
func (s *Service) ActAs(ctx context.Context, p Principal, ownerID string) (Principal, error) {
	if p.Role != RoleAdmin || p.ActorID != "" {
		return Principal{}, ErrForbidden
	}
	if _, err := s.findMember(ctx, ownerID); err != nil {
		return Principal{}, err
	}
	return Principal{OwnerID: ownerID, Role: RoleAdmin, Login: p.Login, ActorID: p.OwnerID}, nil
}

// findMember looks up the password account behind a member owner ID. A
// malformed ID is store.ErrNotFound too.
func (s *Service) findMember(ctx context.Context, ownerID string) (store.PasswordAccount, error) {
	accountID, ok := memberAccountID(Principal{OwnerID: ownerID})
	if !ok {
		return store.PasswordAccount{}, store.ErrNotFound
	}
	a, err := s.Store.FindPasswordAccountByID(ctx, accountID)
	if errors.Is(err, store.ErrNotFound) {
		return store.PasswordAccount{}, store.ErrNotFound
	}
	if err != nil {
		return store.PasswordAccount{}, fmt.Errorf("auth: find password account: %w", err)
	}
	return a, nil
}

// Me returns the caller's profile. A member whose account no longer exists is
// ErrUnauthorized.
func (s *Service) Me(ctx context.Context, p Principal) (Me, error) {
	switch p.Role {
	case RoleAdmin:
		m := Me{OwnerID: p.OwnerID, Role: RoleAdmin, Login: p.Login}
		if p.ActorID == "" {
			return m, nil
		}
		a, err := s.findMember(ctx, p.OwnerID)
		if err != nil {
			return Me{}, err
		}
		m.ActingAs = ActingAs{OwnerID: p.OwnerID, LoginID: a.LoginID, DisplayName: a.DisplayName}
		return m, nil
	case RoleGuest:
		return Me{OwnerID: GuestOwnerID, Role: RoleGuest, Login: guestLogin}, nil
	case RoleMember:
		if sub, ok := ffpfAccountID(p); ok {
			a, err := s.Store.FindFfpfAccount(ctx, sub)
			if errors.Is(err, store.ErrNotFound) {
				return Me{}, ErrUnauthorized
			}
			if err != nil {
				return Me{}, fmt.Errorf("auth: find ffpf account: %w", err)
			}
			// Access tokens carry no login for members, so the email comes
			// from the account, as recorded at the latest sign-in.
			return Me{OwnerID: p.OwnerID, Role: RoleMember, Login: a.Email, DisplayName: a.DisplayName}, nil
		}
		accountID, ok := memberAccountID(p)
		if !ok {
			return Me{}, ErrUnauthorized
		}
		a, err := s.Store.FindPasswordAccountByID(ctx, accountID)
		if errors.Is(err, store.ErrNotFound) {
			return Me{}, ErrUnauthorized
		}
		if err != nil {
			return Me{}, fmt.Errorf("auth: find password account: %w", err)
		}
		return Me{OwnerID: p.OwnerID, Role: RoleMember, Login: a.LoginID, DisplayName: a.DisplayName, AccountID: a.ID}, nil
	default:
		return Me{}, ErrUnauthorized
	}
}
