package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// guestLogin is the Login shown for guests.
const guestLogin = "guest"

// Me describes the signed-in caller. DisplayName and AccountID are set for
// members only.
type Me struct {
	OwnerID, Role, Login, DisplayName, AccountID string
}

// Me returns the caller's profile. A member whose account no longer exists is
// ErrUnauthorized.
func (s *Service) Me(ctx context.Context, p Principal) (Me, error) {
	switch p.Role {
	case RoleAdmin:
		return Me{OwnerID: p.OwnerID, Role: RoleAdmin, Login: p.Login}, nil
	case RoleGuest:
		return Me{OwnerID: GuestOwnerID, Role: RoleGuest, Login: guestLogin}, nil
	case RoleMember:
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
