package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

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
// allowed: guests always are; admins' GitHub user ID must still be allowlisted (else
// ErrForbidden) and members' session version must still match (else
// ErrUnauthorized).
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
		// OwnerID is the numeric GitHub user ID; Login is informational only.
		if !s.Allowlist.Allows(p.OwnerID) {
			return ErrForbidden
		}
		return nil
	case RoleMember:
		accountID, ok := memberAccountID(p)
		if !ok {
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
	case RoleGuest:
		// Guests hold no data and no credentials, so there is nothing to revoke.
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
	case RoleGuest:
		return Principal{OwnerID: GuestOwnerID, Role: RoleGuest}, nil
	default:
		return Principal{}, ErrUnauthorized
	}
}

func hashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
