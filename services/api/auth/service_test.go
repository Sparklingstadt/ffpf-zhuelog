package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// --- fakes ---------------------------------------------------------------

type testClock struct{ t time.Time }

func (c *testClock) Now() time.Time          { return c.t }
func (c *testClock) Advance(d time.Duration) { c.t = c.t.Add(d) }

// callLog records the order of store and hasher calls.
type callLog struct{ calls []string }

func (l *callLog) add(name string) { l.calls = append(l.calls, name) }

func (l *callLog) has(name string) bool { return slices.Contains(l.calls, name) }

// fakeStore is an in-memory Store. Password hashes are "hash:"+password.
type fakeStore struct {
	log      *callLog
	accounts map[string]*store.PasswordAccount // by loginID
	tokens   map[string]*store.RefreshToken    // by token hash
	nextID   int

	lookups        []string // loginIDs passed to FindPasswordAccountByLoginID
	pruned         []string // ownerIDs passed to PruneRefreshTokens
	revoked        []string // familyIDs passed to RevokeFamily
	locked         bool     // ReserveAttempt returns false
	rotateLoses    bool     // RotateRefreshToken returns false
	findAccountErr error
	sessionErr     error
	pruneErr       error
}

func newFakeStore(log *callLog) *fakeStore {
	return &fakeStore{log: log, accounts: map[string]*store.PasswordAccount{}, tokens: map[string]*store.RefreshToken{}}
}

func (f *fakeStore) addAccount(id, loginID, password string, sv int) *store.PasswordAccount {
	a := &store.PasswordAccount{ID: id, LoginID: loginID, PasswordHash: "hash:" + password, SessionVersion: sv}
	f.accounts[loginID] = a
	return a
}

func (f *fakeStore) FindPasswordAccountByLoginID(_ context.Context, loginID string) (store.PasswordAccount, error) {
	f.log.add("FindPasswordAccountByLoginID")
	f.lookups = append(f.lookups, loginID)
	if f.findAccountErr != nil {
		return store.PasswordAccount{}, f.findAccountErr
	}
	a, ok := f.accounts[loginID]
	if !ok {
		return store.PasswordAccount{}, store.ErrNotFound
	}
	return *a, nil
}

func (f *fakeStore) SessionVersion(_ context.Context, accountID string) (int, error) {
	f.log.add("SessionVersion")
	if f.sessionErr != nil {
		return 0, f.sessionErr
	}
	for _, a := range f.accounts {
		if a.ID == accountID {
			return a.SessionVersion, nil
		}
	}
	return 0, store.ErrNotFound
}

func (f *fakeStore) ReserveAttempt(_ context.Context, _ string, _ time.Time) (bool, error) {
	f.log.add("ReserveAttempt")
	return !f.locked, nil
}

func (f *fakeStore) ClearFailures(_ context.Context, _ string) error {
	f.log.add("ClearFailures")
	return nil
}

func (f *fakeStore) insert(t store.RefreshToken, hash string) {
	if t.ID == "" {
		f.nextID++
		t.ID = fmt.Sprintf("crow%d", f.nextID)
	}
	f.tokens[hash] = &t
}

func (f *fakeStore) InsertRefreshToken(_ context.Context, t store.RefreshToken, hash string) error {
	f.log.add("InsertRefreshToken")
	f.insert(t, hash)
	return nil
}

func (f *fakeStore) FindRefreshToken(_ context.Context, hash string) (store.RefreshToken, error) {
	f.log.add("FindRefreshToken")
	t, ok := f.tokens[hash]
	if !ok {
		return store.RefreshToken{}, store.ErrNotFound
	}
	return *t, nil
}

func (f *fakeStore) RotateRefreshToken(_ context.Context, oldID string, next store.RefreshToken, nextHash string, now time.Time) (bool, error) {
	f.log.add("RotateRefreshToken")
	if f.rotateLoses {
		return false, nil
	}
	for _, t := range f.tokens {
		if t.ID == oldID && t.RevokedAt == nil {
			t.RevokedAt = &now
			f.insert(next, nextHash)
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeStore) RevokeFamily(_ context.Context, familyID string, now time.Time) error {
	f.log.add("RevokeFamily")
	f.revoked = append(f.revoked, familyID)
	for _, t := range f.tokens {
		if t.FamilyID == familyID && t.RevokedAt == nil {
			t.RevokedAt = &now
		}
	}
	return nil
}

func (f *fakeStore) PruneRefreshTokens(_ context.Context, ownerID string, _ time.Time) error {
	f.log.add("PruneRefreshTokens")
	f.pruned = append(f.pruned, ownerID)
	return f.pruneErr
}

// row returns the stored row for a refresh token, failing if it is missing.
func (f *fakeStore) row(t *testing.T, refreshToken string) store.RefreshToken {
	t.Helper()
	sum := sha256.Sum256([]byte(refreshToken))
	r, ok := f.tokens[hex.EncodeToString(sum[:])]
	if !ok {
		t.Fatalf("no row stored under the refresh token's sha256 hex")
	}
	return *r
}

func (f *fakeStore) familyRevoked(familyID string) bool {
	found := false
	for _, t := range f.tokens {
		if t.FamilyID == familyID {
			found = true
			if t.RevokedAt == nil {
				return false
			}
		}
	}
	return found
}

// fakeHasher counts every Verify and Simulate as one hash computation.
type fakeHasher struct {
	log       *callLog
	count     int
	passwords []string
}

func (h *fakeHasher) Verify(password, hash string) bool {
	h.log.add("Verify")
	h.count++
	h.passwords = append(h.passwords, password)
	return hash == "hash:"+password
}

func (h *fakeHasher) Simulate(password string) {
	h.log.add("Simulate")
	h.count++
	h.passwords = append(h.passwords, password)
}

type stubGitHub struct {
	user                        GitHubUser
	err                         error
	code, verifier, redirectURI string
}

func (g *stubGitHub) Exchange(_ context.Context, code, verifier, redirectURI string) (GitHubUser, error) {
	g.code, g.verifier, g.redirectURI = code, verifier, redirectURI
	return g.user, g.err
}

type fixture struct {
	svc    *Service
	store  *fakeStore
	hasher *fakeHasher
	github *stubGitHub
	clock  *testClock
	log    *callLog
}

var serviceEpoch = time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

func newFixture() *fixture {
	log := &callLog{}
	clk := &testClock{t: serviceEpoch}
	f := &fixture{
		store:  newFakeStore(log),
		hasher: &fakeHasher{log: log},
		github: &stubGitHub{user: GitHubUser{ID: 42, Login: "Alice"}},
		clock:  clk,
		log:    log,
	}
	f.svc = &Service{
		Store:     f.store,
		Signer:    NewSigner(testSecret, clk.Now),
		GitHub:    f.github,
		Allowlist: ParseAllowlist("alice"),
		Passwords: f.hasher,
		Now:       clk.Now,
	}
	return f
}

func (f *fixture) loginAdmin(t *testing.T) TokenPair {
	t.Helper()
	pair, err := f.svc.LoginGitHub(context.Background(), "code", "verifier", "app://callback")
	if err != nil {
		t.Fatalf("LoginGitHub: %v", err)
	}
	return pair
}

func (f *fixture) loginMember(t *testing.T) TokenPair {
	t.Helper()
	if _, ok := f.store.accounts["alice"]; !ok {
		f.store.addAccount("cacc1", "alice", "correct horse", 3)
	}
	pair, err := f.svc.LoginPassword(context.Background(), "alice", "correct horse")
	if err != nil {
		t.Fatalf("LoginPassword: %v", err)
	}
	return pair
}

func verifyAccess(t *testing.T, f *fixture, token string) Principal {
	t.Helper()
	p, err := f.svc.Signer.Verify(token)
	if err != nil {
		t.Fatalf("access token does not verify: %v", err)
	}
	return p
}

func checkRefreshTokenShape(t *testing.T, token string) {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(b) != 32 {
		t.Fatalf("refresh token is not 32 bytes of unpadded base64url (len %d, err %v)", len(b), err)
	}
}

// --- LoginGitHub ---------------------------------------------------------

func TestLoginGitHubAllowed(t *testing.T) {
	f := newFixture()
	pair := f.loginAdmin(t)

	if f.github.code != "code" || f.github.verifier != "verifier" || f.github.redirectURI != "app://callback" {
		t.Fatalf("Exchange got (%q, %q, %q)", f.github.code, f.github.verifier, f.github.redirectURI)
	}
	if pair.ExpiresIn != 900 {
		t.Fatalf("ExpiresIn = %d, want 900", pair.ExpiresIn)
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
	f := newFixture()
	f.svc.Allowlist = ParseAllowlist("bob")
	_, err := f.svc.LoginGitHub(context.Background(), "code", "verifier", "app://callback")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
	if len(f.store.tokens) != 0 || len(f.store.pruned) != 0 {
		t.Fatalf("forbidden login touched tokens: %d rows, pruned %v", len(f.store.tokens), f.store.pruned)
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
	if _, err := f.svc.LoginPassword(context.Background(), "alice", "pw"); err == nil {
		t.Fatalf("LoginPassword succeeded despite prune error")
	}
	if len(f.store.tokens) != 0 {
		t.Fatalf("rows written despite prune error: %d", len(f.store.tokens))
	}
}

// --- LoginPassword -------------------------------------------------------

func TestLoginPasswordSuccess(t *testing.T) {
	f := newFixture()
	f.store.addAccount("cacc1", "alice", "correct horse", 3)

	pair, err := f.svc.LoginPassword(context.Background(), "alice", "correct horse")
	if err != nil {
		t.Fatalf("LoginPassword: %v", err)
	}
	wantCalls := []string{"FindPasswordAccountByLoginID", "ReserveAttempt", "Verify", "ClearFailures", "PruneRefreshTokens", "InsertRefreshToken"}
	if !slices.Equal(f.log.calls, wantCalls) {
		t.Fatalf("calls = %v, want %v", f.log.calls, wantCalls)
	}
	if pair.ExpiresIn != 900 {
		t.Fatalf("ExpiresIn = %d, want 900", pair.ExpiresIn)
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
}

func TestLoginPasswordSessionVersionZeroAndMultibyte(t *testing.T) {
	f := newFixture()
	pw := strings.Repeat("パ", 128) // 128 runes, 384 bytes
	f.store.addAccount("cacc2", "bob.k_9-x", pw, 0)

	pair, err := f.svc.LoginPassword(context.Background(), "bob.k_9-x", pw)
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
	if _, err := f.svc.LoginPassword(context.Background(), "  Alice ", "pw"); err != nil {
		t.Fatalf("LoginPassword: %v", err)
	}
	if !slices.Equal(f.store.lookups, []string{"alice"}) {
		t.Fatalf("lookups = %q, want [alice]", f.store.lookups)
	}
}

func TestLoginPasswordFailuresAreUniform(t *testing.T) {
	cases := []struct {
		name, loginID, password string
		locked                  bool
		wantLookup              bool
	}{
		{name: "short login id", loginID: "a", password: "pw"},
		{name: "login id with bad char", loginID: "al ice", password: "pw"},
		{name: "login id too long", loginID: strings.Repeat("a", 33), password: "pw"},
		{name: "empty password", loginID: "alice", password: ""},
		{name: "129-rune password", loginID: "alice", password: strings.Repeat("x", 129)},
		{name: "129-rune multibyte password", loginID: "alice", password: strings.Repeat("パ", 129)},
		{name: "unknown login id", loginID: "nobody", password: "pw", wantLookup: true},
		{name: "locked", loginID: "alice", password: "pw", locked: true, wantLookup: true},
		{name: "wrong password", loginID: "alice", password: "wrong", wantLookup: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture()
			f.store.addAccount("cacc1", "alice", "pw", 0)
			f.store.locked = tc.locked

			_, err := f.svc.LoginPassword(context.Background(), tc.loginID, tc.password)
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
			if f.log.has("ClearFailures") {
				t.Fatalf("ClearFailures called on failure")
			}
			if got := len(f.store.lookups) > 0; got != tc.wantLookup {
				t.Fatalf("store lookup = %v, want %v", got, tc.wantLookup)
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
	_, err := f.svc.LoginPassword(context.Background(), "alice", "s3cret-pw")
	if err == nil || errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want a non-sentinel error", err)
	}
	if strings.Contains(err.Error(), "s3cret-pw") {
		t.Fatalf("error leaks the password: %v", err)
	}
}

// --- Refresh -------------------------------------------------------------

func TestRefreshRotates(t *testing.T) {
	for _, role := range []string{RoleAdmin, RoleMember} {
		t.Run(role, func(t *testing.T) {
			f := newFixture()
			var first TokenPair
			if role == RoleAdmin {
				first = f.loginAdmin(t)
			} else {
				first = f.loginMember(t)
			}
			oldRow := f.store.row(t, first.RefreshToken)
			oldPrincipal := verifyAccess(t, f, first.AccessToken)

			f.clock.Advance(time.Hour)
			second, err := f.svc.Refresh(context.Background(), first.RefreshToken)
			if err != nil {
				t.Fatalf("Refresh: %v", err)
			}
			if second.RefreshToken == first.RefreshToken || second.AccessToken == first.AccessToken {
				t.Fatalf("Refresh returned the same tokens")
			}
			if second.ExpiresIn != 900 {
				t.Fatalf("ExpiresIn = %d", second.ExpiresIn)
			}
			if got := verifyAccess(t, f, second.AccessToken); got != oldPrincipal {
				t.Fatalf("principal = %+v, want %+v", got, oldPrincipal)
			}
			checkRefreshTokenShape(t, second.RefreshToken)
			newRow := f.store.row(t, second.RefreshToken)
			if newRow.ID == oldRow.ID || newRow.FamilyID != oldRow.FamilyID || newRow.OwnerID != oldRow.OwnerID ||
				newRow.Role != oldRow.Role || newRow.Login != oldRow.Login ||
				(newRow.SessionVersion == nil) != (oldRow.SessionVersion == nil) ||
				(newRow.SessionVersion != nil && *newRow.SessionVersion != *oldRow.SessionVersion) {
				t.Fatalf("new row %+v does not carry old row %+v", newRow, oldRow)
			}
			if !newRow.ExpiresAt.Equal(serviceEpoch.Add(time.Hour + 30*24*time.Hour)) {
				t.Fatalf("new ExpiresAt = %v, want refresh time + 30d", newRow.ExpiresAt)
			}
			if f.store.row(t, first.RefreshToken).RevokedAt == nil {
				t.Fatalf("old row not revoked")
			}

			// Reusing the old token is theft: the whole family dies.
			if _, err := f.svc.Refresh(context.Background(), first.RefreshToken); err != ErrUnauthorized {
				t.Fatalf("reuse err = %v, want ErrUnauthorized", err)
			}
			if !f.store.familyRevoked(oldRow.FamilyID) {
				t.Fatalf("family not revoked after reuse")
			}
			if _, err := f.svc.Refresh(context.Background(), second.RefreshToken); err != ErrUnauthorized {
				t.Fatalf("refresh with revoked family err = %v, want ErrUnauthorized", err)
			}
		})
	}
}

func TestRefreshExpired(t *testing.T) {
	f := newFixture()
	pair := f.loginMember(t)
	f.clock.Advance(30 * 24 * time.Hour) // ExpiresAt == now
	if _, err := f.svc.Refresh(context.Background(), pair.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if f.log.has("RotateRefreshToken") {
		t.Fatalf("expired token was rotated")
	}
}

func TestRefreshUnknownOrEmpty(t *testing.T) {
	f := newFixture()
	for _, tok := range []string{"", "not-a-known-token"} {
		if _, err := f.svc.Refresh(context.Background(), tok); err != ErrUnauthorized {
			t.Fatalf("Refresh(%q) err = %v, want ErrUnauthorized", tok, err)
		}
	}
	if len(f.store.revoked) != 0 {
		t.Fatalf("revoked %v for unknown tokens", f.store.revoked)
	}
}

func TestRefreshRevokedMember(t *testing.T) {
	t.Run("session version changed", func(t *testing.T) {
		f := newFixture()
		pair := f.loginMember(t)
		f.store.accounts["alice"].SessionVersion = 4
		if _, err := f.svc.Refresh(context.Background(), pair.RefreshToken); err != ErrUnauthorized {
			t.Fatalf("err = %v, want ErrUnauthorized", err)
		}
		if !f.store.familyRevoked(f.store.row(t, pair.RefreshToken).FamilyID) {
			t.Fatalf("family not revoked")
		}
	})
	t.Run("account deleted", func(t *testing.T) {
		f := newFixture()
		pair := f.loginMember(t)
		delete(f.store.accounts, "alice")
		if _, err := f.svc.Refresh(context.Background(), pair.RefreshToken); err != ErrUnauthorized {
			t.Fatalf("err = %v, want ErrUnauthorized", err)
		}
		if !f.store.familyRevoked(f.store.row(t, pair.RefreshToken).FamilyID) {
			t.Fatalf("family not revoked")
		}
	})
}

func TestRefreshRemovedAdmin(t *testing.T) {
	f := newFixture()
	pair := f.loginAdmin(t)
	f.svc.Allowlist = ParseAllowlist("bob")
	if _, err := f.svc.Refresh(context.Background(), pair.RefreshToken); err != ErrForbidden {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
	if !f.store.familyRevoked(f.store.row(t, pair.RefreshToken).FamilyID) {
		t.Fatalf("family not revoked")
	}
}

func TestRefreshLostRace(t *testing.T) {
	f := newFixture()
	pair := f.loginMember(t)
	f.store.rotateLoses = true
	if _, err := f.svc.Refresh(context.Background(), pair.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if !f.store.familyRevoked(f.store.row(t, pair.RefreshToken).FamilyID) {
		t.Fatalf("family not revoked")
	}
}

// --- Logout --------------------------------------------------------------

func TestLogout(t *testing.T) {
	f := newFixture()
	first := f.loginMember(t)
	second, err := f.svc.Refresh(context.Background(), first.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	family := f.store.row(t, second.RefreshToken).FamilyID

	if err := f.svc.Logout(context.Background(), second.RefreshToken); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if !f.store.familyRevoked(family) {
		t.Fatalf("family not revoked by logout")
	}
	if _, err := f.svc.Refresh(context.Background(), second.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("refresh after logout err = %v, want ErrUnauthorized", err)
	}

	for _, tok := range []string{"unknown-token", ""} {
		if err := f.svc.Logout(context.Background(), tok); err != nil {
			t.Fatalf("Logout(%q) = %v, want nil", tok, err)
		}
	}
}

// --- Authenticate --------------------------------------------------------

func TestAuthenticate(t *testing.T) {
	ctx := context.Background()

	t.Run("admin", func(t *testing.T) {
		f := newFixture()
		pair := f.loginAdmin(t)
		p, err := f.svc.Authenticate(ctx, pair.AccessToken)
		if err != nil || p != (Principal{OwnerID: "42", Role: RoleAdmin, Login: "Alice"}) {
			t.Fatalf("Authenticate = %+v, %v", p, err)
		}
		f.svc.Allowlist = ParseAllowlist("bob")
		if _, err := f.svc.Authenticate(ctx, pair.AccessToken); err != ErrForbidden {
			t.Fatalf("removed admin err = %v, want ErrForbidden", err)
		}
	})

	t.Run("member", func(t *testing.T) {
		f := newFixture()
		pair := f.loginMember(t)
		p, err := f.svc.Authenticate(ctx, pair.AccessToken)
		if err != nil || p != (Principal{OwnerID: "password:cacc1", Role: RoleMember, SessionVersion: 3}) {
			t.Fatalf("Authenticate = %+v, %v", p, err)
		}
		f.store.accounts["alice"].SessionVersion = 4
		if _, err := f.svc.Authenticate(ctx, pair.AccessToken); err != ErrUnauthorized {
			t.Fatalf("mismatch err = %v, want ErrUnauthorized", err)
		}
		delete(f.store.accounts, "alice")
		if _, err := f.svc.Authenticate(ctx, pair.AccessToken); err != ErrUnauthorized {
			t.Fatalf("not found err = %v, want ErrUnauthorized", err)
		}
	})

	t.Run("member store error propagates", func(t *testing.T) {
		f := newFixture()
		pair := f.loginMember(t)
		f.store.sessionErr = errors.New("connection reset")
		_, err := f.svc.Authenticate(ctx, pair.AccessToken)
		if err == nil || errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrForbidden) {
			t.Fatalf("err = %v, want a non-sentinel error", err)
		}
	})

	t.Run("member owner without prefix", func(t *testing.T) {
		f := newFixture()
		f.store.addAccount("42", "alice", "pw", 0)
		tok, err := f.svc.Signer.Issue(Principal{OwnerID: "42", Role: RoleMember, SessionVersion: 0})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.Authenticate(ctx, tok); err != ErrUnauthorized {
			t.Fatalf("err = %v, want ErrUnauthorized", err)
		}
	})

	t.Run("invalid or expired token", func(t *testing.T) {
		f := newFixture()
		pair := f.loginAdmin(t)
		if _, err := f.svc.Authenticate(ctx, "garbage"); err != ErrUnauthorized {
			t.Fatalf("garbage err = %v, want ErrUnauthorized", err)
		}
		f.clock.Advance(AccessTTL + time.Second)
		if _, err := f.svc.Authenticate(ctx, pair.AccessToken); err != ErrUnauthorized {
			t.Fatalf("expired err = %v, want ErrUnauthorized", err)
		}
	})
}

func TestNilNowUsesWallClock(t *testing.T) {
	f := newFixture()
	f.svc.Now = nil
	f.svc.Signer = NewSigner(testSecret, nil)
	before := time.Now()
	pair := f.loginAdmin(t)
	exp := f.store.row(t, pair.RefreshToken).ExpiresAt
	if exp.Before(before.Add(RefreshTTL)) || exp.After(time.Now().Add(RefreshTTL)) {
		t.Fatalf("ExpiresAt %v not based on wall clock", exp)
	}
}
