package auth

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestLoginGitHubAllowed(t *testing.T) {
	f := newFixture()
	pair := f.loginAdmin(t)

	if f.github.code != "code" || f.github.verifier != "verifier" || f.github.redirectURI != "app://callback" {
		t.Fatalf("Exchange got (%q, %q, %q)", f.github.code, f.github.verifier, f.github.redirectURI)
	}
	if pair.ExpiresIn != 900 {
		t.Fatalf("ExpiresIn = %d, want 900", pair.ExpiresIn)
	}
	if pair.RefreshExpiresIn != 30*24*60*60 {
		t.Fatalf("RefreshExpiresIn = %d, want 30 days", pair.RefreshExpiresIn)
	}
	want := Principal{OwnerID: "42", Role: RoleAdmin, Login: "Alice"}
	if got := verifyAccess(t, f, pair.AccessToken); got != want {
		t.Fatalf("principal = %+v, want %+v", got, want)
	}

	checkRefreshTokenShape(t, pair.RefreshToken)
	row := f.store.row(t, pair.RefreshToken)
	if row.OwnerID != "42" || row.Role != RoleAdmin || row.Login != "Alice" || row.SessionVersion != nil {
		t.Fatalf("row = %+v", row)
	}
	if !row.ExpiresAt.Equal(serviceEpoch.Add(30 * 24 * time.Hour)) {
		t.Fatalf("ExpiresAt = %v, want now+30d", row.ExpiresAt)
	}
	if row.RevokedAt != nil {
		t.Fatalf("new row is revoked")
	}
	if fam, err := hex.DecodeString(row.FamilyID); err != nil || len(fam) != 16 {
		t.Fatalf("FamilyID %q is not 16 bytes of hex", row.FamilyID)
	}
	if !slices.Equal(f.store.pruned, []string{"42"}) {
		t.Fatalf("pruned = %v, want [42]", f.store.pruned)
	}
	if i, j := slices.Index(f.log.calls, "PruneRefreshTokens"), slices.Index(f.log.calls, "InsertRefreshToken"); i < 0 || j < i {
		t.Fatalf("calls = %v, want Prune before Insert", f.log.calls)
	}

	// A second login starts a separate family with a different token.
	second := f.loginAdmin(t)
	if second.RefreshToken == pair.RefreshToken || f.store.row(t, second.RefreshToken).FamilyID == row.FamilyID {
		t.Fatalf("second login reused the token or family")
	}
}

func TestLoginGitHubForbidden(t *testing.T) {
	// Listing the login instead of the ID does not make an admin: logins can
	// be renamed and then registered by someone else.
	for _, list := range []string{"7", "alice", "Alice", "042"} {
		t.Run(list, func(t *testing.T) {
			f := newFixture()
			f.svc.Allowlist = ParseAllowlist(list)
			_, err := f.svc.LoginGitHub(context.Background(), "code", "verifier", "app://callback")
			if !errors.Is(err, ErrForbidden) {
				t.Fatalf("err = %v, want ErrForbidden", err)
			}
			if len(f.store.tokens) != 0 || len(f.store.pruned) != 0 {
				t.Fatalf("forbidden login touched tokens: %d rows, pruned %v", len(f.store.tokens), f.store.pruned)
			}
		})
	}
}

func TestLoginGitHubAllowsByIDWhateverTheLogin(t *testing.T) {
	f := newFixture()
	f.github.user = GitHubUser{ID: 42, Login: "renamed-alice"}
	pair := f.loginAdmin(t)
	want := Principal{OwnerID: "42", Role: RoleAdmin, Login: "renamed-alice"}
	if got := verifyAccess(t, f, pair.AccessToken); got != want {
		t.Fatalf("principal = %+v, want %+v", got, want)
	}
	if _, err := f.svc.Authenticate(context.Background(), pair.AccessToken); err != nil {
		t.Fatalf("Authenticate: %v", err)
	}

	// Someone else who takes over the login "Alice" gets a different ID.
	f.github.user = GitHubUser{ID: 99, Login: "Alice"}
	if _, err := f.svc.LoginGitHub(context.Background(), "code", "verifier", "app://callback"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
}

func TestLoginGitHubExchangeErrors(t *testing.T) {
	for _, want := range []error{ErrUnauthorized, ErrGitHubUnavailable} {
		f := newFixture()
		f.github.err = want
		_, err := f.svc.LoginGitHub(context.Background(), "code", "verifier", "app://callback")
		if !errors.Is(err, want) {
			t.Fatalf("err = %v, want %v", err, want)
		}
		if len(f.store.tokens) != 0 {
			t.Fatalf("failed exchange wrote %d rows", len(f.store.tokens))
		}
	}
}

func TestLoginPruneErrorFailsLogin(t *testing.T) {
	f := newFixture()
	f.store.pruneErr = errors.New("db down")
	if _, err := f.svc.LoginGitHub(context.Background(), "code", "verifier", "app://callback"); err == nil {
		t.Fatalf("LoginGitHub succeeded despite prune error")
	}
	f.store.addAccount("cacc1", "alice", "pw", 0)
	if _, err := f.svc.LoginPassword(context.Background(), testClient, "alice", "pw"); err == nil {
		t.Fatalf("LoginPassword succeeded despite prune error")
	}
	if len(f.store.tokens) != 0 {
		t.Fatalf("rows written despite prune error: %d", len(f.store.tokens))
	}
}

func TestLoginPasswordSuccess(t *testing.T) {
	f := newFixture()
	f.store.addAccount("cacc1", "alice", "correct horse", 3)

	pair, err := f.svc.LoginPassword(context.Background(), testClient, "alice", "correct horse")
	if err != nil {
		t.Fatalf("LoginPassword: %v", err)
	}
	wantCalls := []string{"ConsumeThrottle", "ConsumeThrottle", "FindPasswordAccountByLoginID", "Verify", "ResetThrottle", "PruneRefreshTokens", "InsertRefreshToken"}
	if !slices.Equal(f.log.calls, wantCalls) {
		t.Fatalf("calls = %v, want %v", f.log.calls, wantCalls)
	}
	// Key formats are shared with the web app and must match exactly.
	if want := []string{"client:203.0.113.9", "login:203.0.113.9:alice"}; !slices.Equal(f.store.consumed, want) {
		t.Fatalf("consumed = %q, want %q", f.store.consumed, want)
	}
	if want := []string{"login:203.0.113.9:alice"}; !slices.Equal(f.store.resets, want) {
		t.Fatalf("resets = %q, want %q", f.store.resets, want)
	}
	// Only the per-login count is reset; the per-client count stays.
	if n := f.store.throttleCount("client:203.0.113.9"); n != 1 {
		t.Fatalf("client count = %d, want 1", n)
	}
	if pair.ExpiresIn != 900 {
		t.Fatalf("ExpiresIn = %d, want 900", pair.ExpiresIn)
	}
	if pair.RefreshExpiresIn != 30*24*60*60 {
		t.Fatalf("RefreshExpiresIn = %d, want 30 days", pair.RefreshExpiresIn)
	}
	want := Principal{OwnerID: "password:cacc1", Role: RoleMember, SessionVersion: 3}
	if got := verifyAccess(t, f, pair.AccessToken); got != want {
		t.Fatalf("principal = %+v, want %+v", got, want)
	}
	checkRefreshTokenShape(t, pair.RefreshToken)
	row := f.store.row(t, pair.RefreshToken)
	if row.OwnerID != "password:cacc1" || row.Role != RoleMember || row.Login != "" ||
		row.SessionVersion == nil || *row.SessionVersion != 3 {
		t.Fatalf("row = %+v", row)
	}
	if !row.ExpiresAt.Equal(serviceEpoch.Add(30 * 24 * time.Hour)) {
		t.Fatalf("ExpiresAt = %v, want now+30d", row.ExpiresAt)
	}
	if !slices.Equal(f.store.pruned, []string{"password:cacc1"}) {
		t.Fatalf("pruned = %v", f.store.pruned)
	}
	if f.hasher.count != 1 {
		t.Fatalf("hash computations = %d, want 1", f.hasher.count)
	}
	// The throttle window is opened at the service clock, not time.Now.
	if e := f.store.throttle["client:203.0.113.9"]; e == nil || !e.expires.Equal(serviceEpoch.Add(15*time.Minute)) {
		t.Fatalf("client throttle window = %+v, want expiry at the service clock + 15m", e)
	}
}

func TestLoginPasswordSessionVersionZeroAndMultibyte(t *testing.T) {
	f := newFixture()
	pw := strings.Repeat("パ", 128) // 128 runes, 384 bytes
	f.store.addAccount("cacc2", "bob.k_9-x", pw, 0)

	pair, err := f.svc.LoginPassword(context.Background(), testClient, "bob.k_9-x", pw)
	if err != nil {
		t.Fatalf("LoginPassword: %v", err)
	}
	if got := verifyAccess(t, f, pair.AccessToken); got.SessionVersion != 0 || got.OwnerID != "password:cacc2" {
		t.Fatalf("principal = %+v", got)
	}
	if sv := f.store.row(t, pair.RefreshToken).SessionVersion; sv == nil || *sv != 0 {
		t.Fatalf("row SessionVersion = %v, want 0", sv)
	}
}

func TestLoginPasswordNormalizesLoginID(t *testing.T) {
	f := newFixture()
	f.store.addAccount("cacc1", "alice", "pw", 0)
	if _, err := f.svc.LoginPassword(context.Background(), testClient, "  Alice ", "pw"); err != nil {
		t.Fatalf("LoginPassword: %v", err)
	}
	if !slices.Equal(f.store.lookups, []string{"alice"}) {
		t.Fatalf("lookups = %q, want [alice]", f.store.lookups)
	}
	if f.store.consumed[1] != "login:"+testClient+":alice" {
		t.Fatalf("login key = %q, want the normalised loginId", f.store.consumed[1])
	}
}

// The loginId is trimmed and lowercased like the web's zod
// .trim().toLowerCase(): JS trim removes U+FEFF but not U+0085, and
// toLowerCase turns U+0130 into "i" + U+0307.
func TestLoginPasswordNormalizesLoginIDLikeJS(t *testing.T) {
	cases := []struct {
		name, loginID string
		wantLookups   []string
	}{
		{"BOM is trimmed", string(rune(0xFEFF)) + "alice", []string{"alice"}},
		{"NEL is not trimmed", string(rune(0x0085)) + "alice", nil},
		{"dotted capital I does not become i", string(rune(0x0130)) + "abc", nil},
		{"Kelvin sign becomes k", string(rune(0x212A)) + "abc", []string{"kabc"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture()
			f.store.addAccount("cacc1", "alice", "pw", 0)
			f.store.addAccount("cacc2", "iabc", "pw", 0)
			f.store.addAccount("cacc3", "kabc", "pw", 0)
			_, err := f.svc.LoginPassword(context.Background(), testClient, tc.loginID, "pw")
			if tc.wantLookups == nil {
				if !errors.Is(err, ErrUnauthorized) {
					t.Fatalf("err = %v, want ErrUnauthorized", err)
				}
			} else if err != nil {
				t.Fatalf("LoginPassword: %v", err)
			}
			if !slices.Equal(f.store.lookups, tc.wantLookups) {
				t.Fatalf("lookups = %q, want %q", f.store.lookups, tc.wantLookups)
			}
		})
	}
}

func TestLoginPasswordFailuresAreUniform(t *testing.T) {
	cases := []struct {
		name, loginID, password string
		wantLookup              bool
	}{
		{name: "short login id", loginID: "a", password: "pw"},
		{name: "login id with bad char", loginID: "al ice", password: "pw"},
		{name: "login id too long", loginID: strings.Repeat("a", 33), password: "pw"},
		{name: "empty password", loginID: "alice", password: ""},
		{name: "129-rune password", loginID: "alice", password: strings.Repeat("x", 129)},
		{name: "129-rune multibyte password", loginID: "alice", password: strings.Repeat("パ", 129)},
		{name: "unknown login id", loginID: "nobody", password: "pw", wantLookup: true},
		{name: "wrong password", loginID: "alice", password: "wrong", wantLookup: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture()
			f.store.addAccount("cacc1", "alice", "pw", 0)

			_, err := f.svc.LoginPassword(context.Background(), testClient, tc.loginID, tc.password)
			if err != ErrUnauthorized {
				t.Fatalf("err = %v, want exactly ErrUnauthorized", err)
			}
			if f.hasher.count != 1 {
				t.Fatalf("hash computations = %d, want 1 (calls %v)", f.hasher.count, f.log.calls)
			}
			for _, p := range f.hasher.passwords {
				if utf8.RuneCountInString(p) > 128 {
					t.Fatalf("hasher got a %d-rune password", utf8.RuneCountInString(p))
				}
			}
			if f.log.has("ResetThrottle") {
				t.Fatalf("ResetThrottle called on failure")
			}
			if got := len(f.store.lookups) > 0; got != tc.wantLookup {
				t.Fatalf("store lookup = %v, want %v", got, tc.wantLookup)
			}
			// Malformed input counts only per client; anything well-formed,
			// known or not, also counts per loginId.
			wantKeys := []string{"client:" + testClient}
			if tc.wantLookup {
				wantKeys = append(wantKeys, "login:"+testClient+":"+tc.loginID)
			}
			if !slices.Equal(f.store.consumed, wantKeys) {
				t.Fatalf("consumed = %q, want %q", f.store.consumed, wantKeys)
			}
			if len(f.store.tokens) != 0 || len(f.store.pruned) != 0 {
				t.Fatalf("failed login touched tokens")
			}
		})
	}
}

func TestLoginPasswordStoreErrorIsNotUnauthorized(t *testing.T) {
	f := newFixture()
	f.store.findAccountErr = errors.New("connection reset")
	_, err := f.svc.LoginPassword(context.Background(), testClient, "alice", "s3cret-pw")
	if err == nil || errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want a non-sentinel error", err)
	}
	if strings.Contains(err.Error(), "s3cret-pw") {
		t.Fatalf("error leaks the password: %v", err)
	}
}

func TestLoginPasswordHasherErrorIsNotUnauthorized(t *testing.T) {
	cases := []struct{ name, loginID, password string }{
		{"malformed (Simulate)", "a", "pw"},
		{"unknown login id (Simulate)", "nobody", "pw"},
		{"known account (Verify)", "alice", "pw"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture()
			f.store.addAccount("cacc1", "alice", "pw", 0)
			f.hasher.err = context.Canceled
			_, err := f.svc.LoginPassword(context.Background(), testClient, tc.loginID, tc.password)
			if !errors.Is(err, context.Canceled) || errors.Is(err, ErrUnauthorized) {
				t.Fatalf("err = %v, want a wrapped context.Canceled, not ErrUnauthorized", err)
			}
			if f.log.has("ResetThrottle") || len(f.store.tokens) != 0 {
				t.Fatalf("hasher failure must not sign in (calls %v)", f.log.calls)
			}
		})
	}
}

func TestLoginPasswordClientLimitBlocksBeforeHashing(t *testing.T) {
	f := newFixture()
	f.store.addAccount("cacc1", "alice", "pw", 0)
	ctx := context.Background()

	// 20 attempts from one client, spread over loginIds so the per-login
	// limit is never reached; malformed ones count too.
	for i := range maxAttemptsPerClient {
		loginID := fmt.Sprintf("user%d", i)
		if i%4 == 0 {
			loginID = "x" // malformed
		}
		if _, err := f.svc.LoginPassword(ctx, testClient, loginID, "pw"); err != ErrUnauthorized {
			t.Fatalf("attempt %d: err = %v, want ErrUnauthorized", i+1, err)
		}
	}
	hashes, lookups := f.hasher.count, len(f.store.lookups)

	// The 21st is refused, even with the right password, before any hashing
	// or lookup.
	if _, err := f.svc.LoginPassword(ctx, testClient, "alice", "pw"); err != ErrThrottled {
		t.Fatalf("21st: err = %v, want ErrThrottled", err)
	}
	if f.hasher.count != hashes || len(f.store.lookups) != lookups {
		t.Fatalf("throttled attempt hashed (%d -> %d) or looked up the account", hashes, f.hasher.count)
	}
	if f.store.consumed[len(f.store.consumed)-1] != "client:"+testClient {
		t.Fatalf("throttled attempt consumed %q after the client key", f.store.consumed[len(f.store.consumed)-1])
	}
	if len(f.store.tokens) != 0 {
		t.Fatalf("throttled attempt signed in")
	}

	// Another client is unaffected, and the window ends after 15 minutes.
	if _, err := f.svc.LoginPassword(ctx, "198.51.100.1", "alice", "pw"); err != nil {
		t.Fatalf("other client: %v", err)
	}
	f.clock.Advance(15 * time.Minute)
	if _, err := f.svc.LoginPassword(ctx, testClient, "alice", "pw"); err != nil {
		t.Fatalf("after the window: %v", err)
	}
}

func TestLoginPasswordLoginLimit(t *testing.T) {
	f := newFixture()
	f.store.addAccount("cacc1", "alice", "pw", 0)
	ctx := context.Background()

	for i := range maxFailuresPerLogin {
		if _, err := f.svc.LoginPassword(ctx, testClient, "alice", "wrong"); err != ErrUnauthorized {
			t.Fatalf("attempt %d: err = %v, want ErrUnauthorized", i+1, err)
		}
	}
	hashes := f.hasher.count

	// The 6th is refused before hashing, even with the right password and a
	// differently cased loginId.
	if _, err := f.svc.LoginPassword(ctx, testClient, " ALICE ", "pw"); err != ErrThrottled {
		t.Fatalf("6th: err = %v, want ErrThrottled", err)
	}
	if f.hasher.count != hashes || len(f.store.lookups) != maxFailuresPerLogin {
		t.Fatalf("throttled attempt hashed or looked up (calls %v)", f.log.calls)
	}

	// Not a lockout: the member can still sign in from another client, and
	// this client can still try other loginIds.
	if _, err := f.svc.LoginPassword(ctx, "198.51.100.1", "alice", "pw"); err != nil {
		t.Fatalf("other client: %v", err)
	}
	if _, err := f.svc.LoginPassword(ctx, testClient, "bob", "pw"); err != ErrUnauthorized {
		t.Fatalf("other loginId: err = %v, want ErrUnauthorized", err)
	}

	f.clock.Advance(15 * time.Minute)
	if _, err := f.svc.LoginPassword(ctx, testClient, "alice", "pw"); err != nil {
		t.Fatalf("after the window: %v", err)
	}
}

func TestLoginPasswordSuccessResetsLoginCount(t *testing.T) {
	f := newFixture()
	f.store.addAccount("cacc1", "alice", "pw", 0)
	ctx := context.Background()

	for range maxFailuresPerLogin - 1 {
		if _, err := f.svc.LoginPassword(ctx, testClient, "alice", "wrong"); err != ErrUnauthorized {
			t.Fatalf("err = %v, want ErrUnauthorized", err)
		}
	}
	if _, err := f.svc.LoginPassword(ctx, testClient, "alice", "pw"); err != nil {
		t.Fatalf("LoginPassword: %v", err)
	}
	if n := f.store.throttleCount("login:" + testClient + ":alice"); n != 0 {
		t.Fatalf("login count after success = %d, want 0", n)
	}
	// A fresh allowance of failures, not one left over.
	for i := range maxFailuresPerLogin {
		if _, err := f.svc.LoginPassword(ctx, testClient, "alice", "wrong"); err != ErrUnauthorized {
			t.Fatalf("attempt %d after success: err = %v, want ErrUnauthorized", i+1, err)
		}
	}
}

func TestLoginPasswordUnknownLoginIsThrottledLikeKnown(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	for i := range maxFailuresPerLogin {
		if _, err := f.svc.LoginPassword(ctx, testClient, "nobody", "pw"); err != ErrUnauthorized {
			t.Fatalf("attempt %d: err = %v, want ErrUnauthorized", i+1, err)
		}
	}
	if f.hasher.count != maxFailuresPerLogin {
		t.Fatalf("hash computations = %d, want one per attempt", f.hasher.count)
	}
	if _, err := f.svc.LoginPassword(ctx, testClient, "nobody", "pw"); err != ErrThrottled {
		t.Fatalf("6th: err = %v, want ErrThrottled", err)
	}
	if f.hasher.count != maxFailuresPerLogin {
		t.Fatalf("throttled attempt hashed")
	}
	if n := f.store.throttleCount("client:" + testClient); n != maxFailuresPerLogin+1 {
		t.Fatalf("client count = %d, want %d", n, maxFailuresPerLogin+1)
	}
	if n := f.store.throttleCount("login:" + testClient + ":nobody"); n != maxFailuresPerLogin+1 {
		t.Fatalf("login count = %d, want %d", n, maxFailuresPerLogin+1)
	}
}

func TestLoginPasswordThrottleStoreError(t *testing.T) {
	f := newFixture()
	f.store.addAccount("cacc1", "alice", "pw", 0)
	f.store.throttleErr = errors.New("connection reset")
	_, err := f.svc.LoginPassword(context.Background(), testClient, "alice", "s3cret-pw")
	if err == nil || errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrThrottled) {
		t.Fatalf("err = %v, want a non-sentinel error", err)
	}
	if strings.Contains(err.Error(), "s3cret-pw") {
		t.Fatalf("error leaks the password: %v", err)
	}
	if f.hasher.count != 0 || len(f.store.lookups) != 0 || len(f.store.tokens) != 0 {
		t.Fatalf("store error did not stop the sign-in (calls %v)", f.log.calls)
	}
}

func TestLoginGuest(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	pair, err := f.svc.LoginGuest(ctx)
	if err != nil {
		t.Fatalf("LoginGuest: %v", err)
	}
	want := Principal{OwnerID: GuestOwnerID, Role: RoleGuest}
	if got := verifyAccess(t, f, pair.AccessToken); got != want {
		t.Fatalf("access token principal = %+v, want %+v", got, want)
	}
	checkRefreshTokenShape(t, pair.RefreshToken)
	if pair.RefreshExpiresIn != 24*60*60 {
		t.Fatalf("RefreshExpiresIn = %d, want 24 hours", pair.RefreshExpiresIn)
	}

	// The guest is always current and can rotate its refresh token.
	if p, err := f.svc.Authenticate(ctx, pair.AccessToken); err != nil || p != want {
		t.Fatalf("Authenticate = %+v, %v", p, err)
	}
	next, err := f.svc.Refresh(ctx, pair.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if got := verifyAccess(t, f, next.AccessToken); got != want {
		t.Fatalf("refreshed principal = %+v, want %+v", got, want)
	}
	if next.RefreshToken == pair.RefreshToken {
		t.Fatal("refresh token was not rotated")
	}
	if next.RefreshExpiresIn != 24*60*60 {
		t.Fatalf("refreshed RefreshExpiresIn = %d, want 24 hours", next.RefreshExpiresIn)
	}
}

func TestLoginGuestRefreshTokenLifetimeAndCleanup(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	first, err := f.svc.LoginGuest(ctx)
	if err != nil {
		t.Fatalf("LoginGuest: %v", err)
	}
	row := f.store.row(t, first.RefreshToken)
	if want := serviceEpoch.Add(24 * time.Hour); !row.ExpiresAt.Equal(want) {
		t.Fatalf("guest refresh expires at %v, want %v", row.ExpiresAt, want)
	}
	if len(f.store.pruned) != 0 {
		t.Fatalf("guest login ran the family prune for %v", f.store.pruned)
	}
	if !slices.Equal(f.store.deletedExpired, []string{GuestOwnerID}) {
		t.Fatalf("deletedExpired = %v, want [guest]", f.store.deletedExpired)
	}

	// A later guest login removes the expired row, and rotation keeps the
	// short lifetime.
	f.clock.t = f.clock.t.Add(25 * time.Hour)
	second, err := f.svc.LoginGuest(ctx)
	if err != nil {
		t.Fatalf("LoginGuest: %v", err)
	}
	if _, ok := f.store.tokens[hashRefreshToken(first.RefreshToken)]; ok {
		t.Fatal("expired guest row was not deleted")
	}
	next, err := f.svc.Refresh(ctx, second.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if want := f.clock.t.Add(24 * time.Hour); !f.store.row(t, next.RefreshToken).ExpiresAt.Equal(want) {
		t.Fatalf("rotated guest row expires at %v, want %v", f.store.row(t, next.RefreshToken).ExpiresAt, want)
	}
}

func TestLoginFFPF(t *testing.T) {
	f, stub := ffpfFixture()
	ctx := context.Background()
	pair := f.loginFFPF(t)
	if stub.code != "code" || stub.verifier != "verifier" || stub.redirectURI != "https://zl.example/cb" || stub.nonce != "nonce1" {
		t.Fatalf("Exchange got (%q, %q, %q, %q)", stub.code, stub.verifier, stub.redirectURI, stub.nonce)
	}
	checkRefreshTokenShape(t, pair.RefreshToken)
	if pair.ExpiresIn != int(AccessTTL/time.Second) || pair.RefreshExpiresIn != int(RefreshTTL/time.Second) {
		t.Fatalf("lifetimes = %d, %d", pair.ExpiresIn, pair.RefreshExpiresIn)
	}

	p, err := f.svc.Authenticate(ctx, pair.AccessToken)
	if err != nil || p.OwnerID != "ffpf:cabc" || p.Role != "member" || p.SessionVersion != 0 {
		t.Fatalf("Authenticate = %+v, %v", p, err)
	}
	row := f.store.row(t, pair.RefreshToken)
	if row.OwnerID != "ffpf:cabc" || row.Role != RoleMember || row.SessionVersion == nil || *row.SessionVersion != 0 {
		t.Fatalf("refresh row = %+v", row)
	}
	if !slices.Contains(f.store.pruned, "ffpf:cabc") {
		t.Fatalf("pruned = %v, want ffpf:cabc", f.store.pruned)
	}

	me, err := f.svc.Me(ctx, p)
	want := Me{OwnerID: "ffpf:cabc", Role: RoleMember, Login: "alice@example.com", DisplayName: "Alice"}
	if err != nil || me != want {
		t.Fatalf("Me = %+v, %v; want %+v", me, err, want)
	}
}

func TestLoginFFPFSecondLoginUpdatesProfile(t *testing.T) {
	f, stub := ffpfFixture()
	ctx := context.Background()
	f.loginFFPF(t)
	stub.user = FFPFUser{Sub: "cabc", Email: "alice@new.example", Name: "Alice B"}
	pair := f.loginFFPF(t)
	if n := len(f.store.ffpf); n != 1 {
		t.Fatalf("%d accounts, want 1", n)
	}
	p, err := f.svc.Authenticate(ctx, pair.AccessToken)
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	me, err := f.svc.Me(ctx, p)
	want := Me{OwnerID: "ffpf:cabc", Role: RoleMember, Login: "alice@new.example", DisplayName: "Alice B"}
	if err != nil || me != want {
		t.Fatalf("Me = %+v, %v; want %+v", me, err, want)
	}
}

func TestLoginFFPFDisplayName(t *testing.T) {
	cases := []struct{ name, email, want string }{
		{"  Alice  ", "a@example.com", "Alice"},
		{"", "local.part@example.com", "local.part"},
		{"   ", "bob@example.com", "bob"},
		{strings.Repeat("あ", 51), "c@example.com", strings.Repeat("あ", 50)},
		{strings.Repeat("x", 50), "d@example.com", strings.Repeat("x", 50)},
	}
	for _, tc := range cases {
		f, stub := ffpfFixture()
		stub.user = FFPFUser{Sub: "cabc", Email: tc.email, Name: tc.name}
		f.loginFFPF(t)
		if got := f.store.ffpf["cabc"].DisplayName; got != tc.want {
			t.Errorf("name %q, email %q: display name = %q, want %q", tc.name, tc.email, got, tc.want)
		}
		if got := f.store.ffpf["cabc"].Email; got != tc.email {
			t.Errorf("email = %q, want %q", got, tc.email)
		}
	}
}

func TestLoginFFPFErrors(t *testing.T) {
	ctx := context.Background()

	t.Run("disabled", func(t *testing.T) {
		f := newFixture()
		if _, err := f.svc.LoginFFPF(ctx, "c", "v", "r", "n"); !errors.Is(err, ErrFFPFDisabled) {
			t.Fatalf("err = %v, want ErrFFPFDisabled", err)
		}
		if len(f.store.tokens) != 0 {
			t.Fatal("a token was stored")
		}
	})
	for _, want := range []error{ErrUnauthorized, ErrFFPFUnavailable} {
		t.Run(want.Error(), func(t *testing.T) {
			f, stub := ffpfFixture()
			stub.err = want
			if _, err := f.svc.LoginFFPF(ctx, "c", "v", "r", "n"); !errors.Is(err, want) {
				t.Fatalf("err = %v, want %v", err, want)
			}
			if f.log.has("UpsertFfpfAccount") || len(f.store.tokens) != 0 {
				t.Fatal("the account or a token was written after a failed exchange")
			}
		})
	}
	// Defence in depth: whatever the FFPF client returns, a sub that cannot
	// form an ffpf:<sub> owner ID never reaches the store.
	for _, sub := range []string{"", "ABC", "a:b", "a/b", "ffpf:x", strings.Repeat("a", 65)} {
		t.Run("malformed sub "+strconv.Quote(sub), func(t *testing.T) {
			f, stub := ffpfFixture()
			stub.user.Sub = sub
			if _, err := f.svc.LoginFFPF(ctx, "c", "v", "r", "n"); !errors.Is(err, ErrUnauthorized) {
				t.Fatalf("err = %v, want ErrUnauthorized", err)
			}
			if f.log.has("UpsertFfpfAccount") || len(f.store.tokens) != 0 {
				t.Fatal("the account or a token was written for a malformed sub")
			}
		})
	}
	t.Run("upsert error", func(t *testing.T) {
		f, _ := ffpfFixture()
		f.store.upsertFfpfErr = errors.New("connection reset")
		_, err := f.svc.LoginFFPF(ctx, "c", "v", "r", "n")
		if err == nil || errors.Is(err, ErrUnauthorized) || len(f.store.tokens) != 0 {
			t.Fatalf("err = %v, tokens %d; want a non-sentinel error and no token", err, len(f.store.tokens))
		}
	})
}
