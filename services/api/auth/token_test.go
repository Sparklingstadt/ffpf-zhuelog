package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var testSecret = []byte("0123456789abcdef0123456789abcdef")

func fixedNow(t time.Time) func() time.Time { return func() time.Time { return t } }

func TestSignerRoundTrip(t *testing.T) {
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	s := NewSigner(testSecret, fixedNow(now))

	cases := []Principal{
		{OwnerID: "12345", Role: RoleAdmin, Login: "alice"},
		{OwnerID: "password:cabc", Role: RoleMember, SessionVersion: 3},
		{OwnerID: "password:cnew", Role: RoleMember, SessionVersion: 0}, // Prisma default
	}
	for _, want := range cases {
		token, err := s.Issue(want)
		if err != nil {
			t.Fatalf("Issue(%+v): %v", want, err)
		}
		got, err := s.Verify(token)
		if err != nil {
			t.Fatalf("Verify: %v", err)
		}
		if got != want {
			t.Fatalf("got %+v, want %+v", got, want)
		}

		claims := jwt.MapClaims{}
		if _, _, err := jwt.NewParser().ParseUnverified(token, claims); err != nil {
			t.Fatal(err)
		}
		iat, _ := claims.GetIssuedAt()
		exp, _ := claims.GetExpirationTime()
		if exp.Sub(iat.Time) != 15*time.Minute {
			t.Fatalf("exp-iat = %v, want 15m", exp.Sub(iat.Time))
		}
		_, hasLogin := claims["login"]
		_, hasSV := claims["sv"]
		if want.Role == RoleMember && hasLogin {
			t.Fatal("member token must not carry login")
		}
		if want.Role == RoleAdmin && hasSV {
			t.Fatal("admin token must not carry sv")
		}
	}
}

func TestIssueRejectsInvalidPrincipal(t *testing.T) {
	s := NewSigner(testSecret, time.Now)
	for _, p := range []Principal{
		{OwnerID: "1", Role: "root"},
		{OwnerID: "", Role: RoleAdmin, Login: "a"},
		{OwnerID: "1", Role: RoleAdmin},
		{OwnerID: "password:x", Role: RoleMember, SessionVersion: -1},
	} {
		if _, err := s.Issue(p); err == nil {
			t.Errorf("Issue(%+v) succeeded, want error", p)
		}
	}
}

func signRaw(t *testing.T, method jwt.SigningMethod, key any, claims jwt.MapClaims) string {
	t.Helper()
	tok, err := jwt.NewWithClaims(method, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func validClaims(now time.Time) jwt.MapClaims {
	return jwt.MapClaims{
		"sub":  "password:cabc",
		"iss":  Issuer,
		"aud":  Audience,
		"iat":  now.Unix(),
		"exp":  now.Add(AccessTTL).Unix(),
		"role": RoleMember,
		"sv":   2,
	}
}

func TestSignerRejects(t *testing.T) {
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	s := NewSigner(testSecret, fixedNow(now))

	with := func(mut func(c jwt.MapClaims)) jwt.MapClaims {
		c := validClaims(now)
		mut(c)
		return c
	}
	adminClaims := func(mut func(c jwt.MapClaims)) jwt.MapClaims {
		c := validClaims(now)
		delete(c, "sv")
		c["role"] = RoleAdmin
		c["sub"] = "12345"
		c["login"] = "alice"
		mut(c)
		return c
	}

	valid, err := s.Issue(Principal{OwnerID: "password:cabc", Role: RoleMember, SessionVersion: 2})
	if err != nil {
		t.Fatal(err)
	}
	expired := NewSigner(testSecret, fixedNow(now.Add(-16*time.Minute)))
	expiredTok, _ := expired.Issue(Principal{OwnerID: "password:cabc", Role: RoleMember, SessionVersion: 2})

	noneTok, err := jwt.NewWithClaims(jwt.SigningMethodNone, validClaims(now)).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}

	cases := map[string]string{
		"expired":           expiredTok,
		"wrong key":         signRaw(t, jwt.SigningMethodHS256, []byte("another-secret-another-secret-xx"), validClaims(now)),
		"wrong aud":         signRaw(t, jwt.SigningMethodHS256, testSecret, with(func(c jwt.MapClaims) { c["aud"] = "other" })),
		"wrong iss":         signRaw(t, jwt.SigningMethodHS256, testSecret, with(func(c jwt.MapClaims) { c["iss"] = "other" })),
		"alg none":          noneTok,
		"HS512":             signRaw(t, jwt.SigningMethodHS512, testSecret, validClaims(now)),
		"garbage":           "not-a-jwt",
		"empty":             "",
		"truncated":         valid[:len(valid)-4],
		"unknown role":      signRaw(t, jwt.SigningMethodHS256, testSecret, with(func(c jwt.MapClaims) { c["role"] = "root" })),
		"missing role":      signRaw(t, jwt.SigningMethodHS256, testSecret, with(func(c jwt.MapClaims) { delete(c, "role") })),
		"member no sv":      signRaw(t, jwt.SigningMethodHS256, testSecret, with(func(c jwt.MapClaims) { delete(c, "sv") })),
		"admin no login":    signRaw(t, jwt.SigningMethodHS256, testSecret, adminClaims(func(c jwt.MapClaims) { delete(c, "login") })),
		"admin empty login": signRaw(t, jwt.SigningMethodHS256, testSecret, adminClaims(func(c jwt.MapClaims) { c["login"] = "" })),
		"missing sub":       signRaw(t, jwt.SigningMethodHS256, testSecret, with(func(c jwt.MapClaims) { delete(c, "sub") })),
		"missing exp":       signRaw(t, jwt.SigningMethodHS256, testSecret, with(func(c jwt.MapClaims) { delete(c, "exp") })),
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			p, err := s.Verify(token)
			if !errors.Is(err, ErrUnauthorized) {
				t.Fatalf("err = %v, want ErrUnauthorized", err)
			}
			if err != ErrUnauthorized { //nolint:errorlint // must be exactly the sentinel
				t.Fatalf("err = %v, want exactly ErrUnauthorized", err)
			}
			if p != (Principal{}) {
				t.Fatalf("principal = %+v, want zero", p)
			}
		})
	}

	// sanity: the crafted-valid claims do verify, so rejections above are due to the mutation.
	for name, tok := range map[string]string{
		"member": signRaw(t, jwt.SigningMethodHS256, testSecret, validClaims(now)),
		"admin":  signRaw(t, jwt.SigningMethodHS256, testSecret, adminClaims(func(jwt.MapClaims) {})),
	} {
		if _, err := s.Verify(tok); err != nil {
			t.Errorf("%s control token rejected: %v", name, err)
		}
	}
	if strings.Count(valid, ".") != 2 {
		t.Fatal("unexpected token shape")
	}
}
