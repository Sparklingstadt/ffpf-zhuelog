// Package auth holds the access-token signer, the scrypt password verifier
// and the GitHub login allowlist.
package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	AccessTTL  = 15 * time.Minute
	RefreshTTL = 30 * 24 * time.Hour
	Issuer     = "ffpf-zhuelog-api"
	Audience   = "ffpf-zhuelog-mobile"
)

const (
	RoleAdmin  = "admin"
	RoleMember = "member"
)

var (
	ErrUnauthorized = errors.New("auth: unauthorized")
	ErrForbidden    = errors.New("auth: forbidden")
)

// Principal is the authenticated caller. For admins, OwnerID is the numeric
// GitHub user ID (what the allowlist checks) and Login the GitHub login at
// sign-in, kept for information only and never used for authorization. For
// members, SessionVersion is set.
type Principal struct {
	OwnerID        string
	Role           string
	Login          string
	SessionVersion int
}

type claims struct {
	jwt.RegisteredClaims
	Role  string `json:"role"`
	Login string `json:"login,omitempty"`
	SV    *int   `json:"sv,omitempty"`
}

// Signer issues and verifies HS256 access tokens.
type Signer struct {
	secret []byte
	now    func() time.Time
}

func NewSigner(secret []byte, now func() time.Time) *Signer {
	if now == nil {
		now = time.Now
	}
	return &Signer{secret: secret, now: now}
}

func (s *Signer) Issue(p Principal) (string, error) {
	if p.OwnerID == "" {
		return "", errors.New("auth: principal has no owner id")
	}
	c := claims{Role: p.Role}
	switch p.Role {
	case RoleAdmin:
		if p.Login == "" {
			return "", errors.New("auth: admin principal has no login")
		}
		c.Login = p.Login
	case RoleMember:
		if p.SessionVersion < 0 {
			return "", errors.New("auth: member principal has a negative session version")
		}
		sv := p.SessionVersion
		c.SV = &sv
	default:
		return "", errors.New("auth: unknown role")
	}

	now := s.now()
	c.RegisteredClaims = jwt.RegisteredClaims{
		Subject:   p.OwnerID,
		Issuer:    Issuer,
		Audience:  jwt.ClaimStrings{Audience},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(AccessTTL)),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(s.secret)
}

// Verify returns the principal for a valid access token. Every failure is
// reported as exactly ErrUnauthorized.
func (s *Signer) Verify(token string) (Principal, error) {
	var c claims
	parsed, err := jwt.ParseWithClaims(token, &c,
		func(*jwt.Token) (any, error) { return s.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer(Issuer),
		jwt.WithAudience(Audience),
		jwt.WithTimeFunc(s.now),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
	)
	if err != nil || !parsed.Valid || c.Subject == "" {
		return Principal{}, ErrUnauthorized
	}

	p := Principal{OwnerID: c.Subject, Role: c.Role}
	switch c.Role {
	case RoleAdmin:
		if c.Login == "" {
			return Principal{}, ErrUnauthorized
		}
		p.Login = c.Login
	case RoleMember:
		if c.SV == nil || *c.SV < 0 {
			return Principal{}, ErrUnauthorized
		}
		p.SessionVersion = *c.SV
	default:
		return Principal{}, ErrUnauthorized
	}
	return p, nil
}
