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
// its whole family (token theft); so does failing the revocation check.
//
// Browsers send parallel requests, so several of them can refresh with the
// same token at once: one rotates it and the others then present (or lose the
// rotation race on) a token that was just revoked. To keep that from logging
// the user out, a token revoked within RefreshReuseGrace of now (in either
// direction, to allow for clock skew) gets a new pair in the same family,
// after the same revocation check, provided the family still has an active
// token; the check and the insert are atomic with respect to family
// revocation. Past the grace, or once the family is dead (logout, reuse
// detected), it is theft as before. The tradeoff: a stolen token used within
// the same RefreshReuseGrace as the victim's own refresh goes undetected.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (TokenPair, error) {
	if refreshToken == "" {
		return TokenPair{}, ErrUnauthorized
	}
	now := s.now()
	hash := hashRefreshToken(refreshToken)
	row, err := s.Store.FindRefreshToken(ctx, hash)
	if errors.Is(err, store.ErrNotFound) {
		return TokenPair{}, ErrUnauthorized
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: find refresh token: %w", err)
	}
	if row.RevokedAt != nil && !withinReuseGrace(now, *row.RevokedAt) {
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
	if row.RevokedAt == nil {
		rotated, err := s.Store.RotateRefreshToken(ctx, row.ID, next, nextHash, now)
		if err != nil {
			return TokenPair{}, fmt.Errorf("auth: rotate refresh token: %w", err)
		}
		if rotated {
			return pair, nil
		}
		// A concurrent refresh rotated it first. Fall through to the grace
		// path only if it really was just rotated.
		again, err := s.Store.FindRefreshToken(ctx, hash)
		if errors.Is(err, store.ErrNotFound) {
			return TokenPair{}, s.revokeFamily(ctx, row.FamilyID, now, ErrUnauthorized)
		}
		if err != nil {
			return TokenPair{}, fmt.Errorf("auth: find refresh token: %w", err)
		}
		if again.RevokedAt == nil || !withinReuseGrace(now, *again.RevokedAt) {
			return TokenPair{}, s.revokeFamily(ctx, row.FamilyID, now, ErrUnauthorized)
		}
	}
	// The presented row is already revoked; add a sibling to its family.
	inserted, err := s.Store.InsertSiblingIfFamilyActive(ctx, next, nextHash, now)
	if err != nil {
		return TokenPair{}, fmt.Errorf("auth: insert sibling refresh token: %w", err)
	}
	if !inserted {
		return TokenPair{}, s.revokeFamily(ctx, row.FamilyID, now, ErrUnauthorized)
	}
	return pair, nil
}

// withinReuseGrace reports whether revokedAt is at most RefreshReuseGrace
// away from now, in either direction.
func withinReuseGrace(now, revokedAt time.Time) bool {
	d := now.Sub(revokedAt)
	return d >= -RefreshReuseGrace && d <= RefreshReuseGrace
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
// allowed: guests always are; admins' GitHub user ID must still be
// allowlisted (else ErrForbidden) and members' session version (of their
// password or FFPF ID account) must still match (else ErrUnauthorized).
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
		// Each kind of member has its own account table and session version.
		var current int
		var err error
		if accountID, ok := memberAccountID(p); ok {
			current, err = s.Store.SessionVersion(ctx, accountID)
		} else if sub, ok := ffpfAccountID(p); ok {
			current, err = s.Store.FfpfSessionVersion(ctx, sub)
		} else {
			return ErrUnauthorized
		}
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
	if p.Role == RoleGuest {
		// All guests share one owner ID and anyone can log in as a guest, so
		// the family-aware prune (a subquery over every live guest row) would
		// scan more with every login. Guests hold nothing worth keeping:
		// delete only the expired rows. With GuestRefreshTTL the table holds
		// at most a day of guest logins.
		if err := s.Store.DeleteExpiredRefreshTokens(ctx, p.OwnerID, now); err != nil {
			return TokenPair{}, fmt.Errorf("auth: delete expired refresh tokens: %w", err)
		}
	} else if err := s.Store.PruneRefreshTokens(ctx, p.OwnerID, now); err != nil {
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
	ttl := RefreshTTL
	if p.Role == RoleGuest {
		ttl = GuestRefreshTTL
	}
	row := store.RefreshToken{
		OwnerID:   p.OwnerID,
		Role:      p.Role,
		FamilyID:  familyID,
		ExpiresAt: now.Add(ttl),
	}
	switch p.Role {
	case RoleAdmin:
		row.Login = p.Login
	case RoleMember:
		sv := p.SessionVersion
		row.SessionVersion = &sv
	}
	pair := TokenPair{
		AccessToken:      access,
		RefreshToken:     refresh,
		ExpiresIn:        int(AccessTTL / time.Second),
		RefreshExpiresIn: int(ttl / time.Second),
	}
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
