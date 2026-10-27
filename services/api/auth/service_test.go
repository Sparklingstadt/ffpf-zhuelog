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
	throttle map[string]*throttleEntry         // by key
	nextID   int

	lookups        []string // loginIDs passed to FindPasswordAccountByLoginID
	consumed       []string // keys passed to ConsumeThrottle
	resets         []string // keys passed to ResetThrottle
	pruned         []string // ownerIDs passed to PruneRefreshTokens
	deletedExpired []string // ownerIDs passed to DeleteExpiredRefreshTokens
	revoked        []string // familyIDs passed to RevokeFamily
	// rotateRace, if set, makes RotateRefreshToken lose a race: it runs (as
	// the concurrent winner would) and RotateRefreshToken returns false.
	rotateRace     func(oldID string, now time.Time)
	findAccountErr error
	sessionErr     error
	pruneErr       error
	throttleErr    error
	setPasswordErr error
	setPasswordAt  []time.Time // now passed to each SetPassword

	ffpf          map[string]*store.FfpfAccount // by sub; see ffpfAccounts
	upsertFfpfErr error
}

// throttleEntry is one fixed window, as in the SignInThrottle table.
type throttleEntry struct {
	count   int
	expires time.Time
}

func newFakeStore(log *callLog) *fakeStore {
	return &fakeStore{
		log:      log,
		accounts: map[string]*store.PasswordAccount{},
		tokens:   map[string]*store.RefreshToken{},
		throttle: map[string]*throttleEntry{},
	}
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

func (f *fakeStore) FindPasswordAccountByID(_ context.Context, id string) (store.PasswordAccount, error) {
	f.log.add("FindPasswordAccountByID")
	if f.findAccountErr != nil {
		return store.PasswordAccount{}, f.findAccountErr
	}
	for _, a := range f.accounts {
		if a.ID == id {
			return *a, nil
		}
	}
	return store.PasswordAccount{}, store.ErrNotFound
}

// SetPassword mirrors the store: it replaces the hash and bumps the session
// version.
func (f *fakeStore) SetPassword(_ context.Context, id, hash string, now time.Time) error {
	f.log.add("SetPassword")
	f.setPasswordAt = append(f.setPasswordAt, now)
	if f.setPasswordErr != nil {
		return f.setPasswordErr
	}
	for _, a := range f.accounts {
		if a.ID == id {
			a.PasswordHash = hash
			a.SessionVersion++
			return nil
		}
	}
	return store.ErrNotFound
}

// ConsumeThrottle mirrors the store: an ended window (expires <= now) restarts
// at 1, otherwise the count goes up, even past the limit.
func (f *fakeStore) ConsumeThrottle(_ context.Context, key string, limit int, window time.Duration, now time.Time) (bool, error) {
	f.log.add("ConsumeThrottle")
	f.consumed = append(f.consumed, key)
	if f.throttleErr != nil {
		return false, f.throttleErr
	}
	if window != 15*time.Minute {
		return false, fmt.Errorf("window = %v, want 15m", window)
	}
	e := f.throttle[key]
	if e == nil || !e.expires.After(now) {
		e = &throttleEntry{expires: now.Add(window)}
		f.throttle[key] = e
	}
	e.count++
	return e.count <= limit, nil
}

func (f *fakeStore) ResetThrottle(_ context.Context, key string) error {
	f.log.add("ResetThrottle")
	f.resets = append(f.resets, key)
	delete(f.throttle, key)
	return nil
}

func (f *fakeStore) throttleCount(key string) int {
	if e := f.throttle[key]; e != nil {
		return e.count
	}
	return 0
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
	if f.rotateRace != nil {
		f.rotateRace(oldID, now)
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

// InsertSiblingIfFamilyActive mirrors the store: it inserts next only if its
// family has an unrevoked, unexpired row.
func (f *fakeStore) InsertSiblingIfFamilyActive(_ context.Context, next store.RefreshToken, nextHash string, now time.Time) (bool, error) {
	f.log.add("InsertSiblingIfFamilyActive")
	for _, t := range f.tokens {
		if t.FamilyID == next.FamilyID && t.RevokedAt == nil && t.ExpiresAt.After(now) {
			f.insert(next, nextHash)
			return true, nil
		}
	}
	return false, nil
}

// revokeID revokes the row with id at now, as a concurrent rotation would.
func (f *fakeStore) revokeID(id string, now time.Time) {
	for _, t := range f.tokens {
		if t.ID == id && t.RevokedAt == nil {
			t.RevokedAt = &now
		}
	}
}

// PruneRefreshTokens mirrors the store: it deletes ownerID's expired rows and
// its revoked rows whose family has no unrevoked, unexpired row.
func (f *fakeStore) PruneRefreshTokens(_ context.Context, ownerID string, now time.Time) error {
	f.log.add("PruneRefreshTokens")
	f.pruned = append(f.pruned, ownerID)
	if f.pruneErr != nil {
		return f.pruneErr
	}
	liveFamilies := map[string]bool{}
	for _, t := range f.tokens {
		if t.OwnerID == ownerID && t.RevokedAt == nil && t.ExpiresAt.After(now) {
			liveFamilies[t.FamilyID] = true
		}
	}
	for hash, t := range f.tokens {
		if t.OwnerID != ownerID {
			continue
		}
		if !t.ExpiresAt.After(now) || (t.RevokedAt != nil && !liveFamilies[t.FamilyID]) {
			delete(f.tokens, hash)
		}
	}
	return nil
}

// DeleteExpiredRefreshTokens mirrors the store: it deletes only ownerID's
// expired rows.
func (f *fakeStore) DeleteExpiredRefreshTokens(_ context.Context, ownerID string, now time.Time) error {
	f.log.add("DeleteExpiredRefreshTokens")
	f.deletedExpired = append(f.deletedExpired, ownerID)
	for hash, t := range f.tokens {
		if t.OwnerID == ownerID && !t.ExpiresAt.After(now) {
			delete(f.tokens, hash)
		}
	}
	return nil
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
// A non-nil err is returned by both, as if waiting for a hashing slot failed.
type fakeHasher struct {
	log       *callLog
	count     int
	passwords []string
	err       error
	hashes    int
	hashErr   error
}

func (h *fakeHasher) Verify(_ context.Context, password, hash string) (bool, error) {
	h.log.add("Verify")
	h.count++
	h.passwords = append(h.passwords, password)
	if h.err != nil {
		return false, h.err
	}
	return hash == "hash:"+password, nil
}

// Hash is not a verification, so it is counted in hashes, not count.
func (h *fakeHasher) Hash(_ context.Context, password string) (string, error) {
	h.log.add("Hash")
	h.hashes++
	if h.hashErr != nil {
		return "", h.hashErr
	}
	return "hash:" + password, nil
}

func (h *fakeHasher) Simulate(_ context.Context, password string) error {
	h.log.add("Simulate")
	h.count++
	h.passwords = append(h.passwords, password)
	return h.err
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

// testClient is the caller address the tests sign in from, as normalised by
// ClientAddress.
const testClient = "203.0.113.9"

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
		Allowlist: ParseAllowlist("42"),
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
	pair, err := f.svc.LoginPassword(context.Background(), testClient, "alice", "correct horse")
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

// --- LoginPassword -------------------------------------------------------

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

// --- LoginPassword throttling --------------------------------------------

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
			if second.RefreshExpiresIn != 30*24*60*60 {
				t.Fatalf("RefreshExpiresIn = %d", second.RefreshExpiresIn)
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

			// Reusing the old token after the grace is theft: the whole
			// family dies.
			f.clock.Advance(RefreshReuseGrace + time.Second)
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
	if len(f.store.revoked) != 0 || f.store.row(t, pair.RefreshToken).RevokedAt != nil {
		t.Fatalf("expired token revoked its family (revoked %v)", f.store.revoked)
	}
}

func TestRefreshReuseDetectedAfterRelogin(t *testing.T) {
	f := newFixture()
	stolen := f.loginMember(t)
	f.clock.Advance(time.Minute)
	live, err := f.svc.Refresh(context.Background(), stolen.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	family := f.store.row(t, live.RefreshToken).FamilyID

	// The owner signs in again; pruning must keep the rotated row of the
	// still-live family.
	f.clock.Advance(time.Minute)
	other := f.loginMember(t)

	if _, err := f.svc.Refresh(context.Background(), stolen.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("replay err = %v, want ErrUnauthorized", err)
	}
	if !f.store.familyRevoked(family) {
		t.Fatalf("replaying the rotated token did not revoke its family")
	}
	if _, err := f.svc.Refresh(context.Background(), live.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("live token of revoked family err = %v, want ErrUnauthorized", err)
	}
	// The newer, separate session is unaffected.
	if _, err := f.svc.Refresh(context.Background(), other.RefreshToken); err != nil {
		t.Fatalf("other family Refresh: %v", err)
	}
}

func TestRefreshMalformedRowRevokesFamily(t *testing.T) {
	cases := map[string]store.RefreshToken{
		"member without session version": {ID: "cbad1", OwnerID: "password:cacc1", Role: RoleMember, FamilyID: "fam-bad"},
		"unknown role":                   {ID: "cbad2", OwnerID: "42", Role: "owner", Login: "Alice", FamilyID: "fam-bad"},
	}
	for name, row := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture()
			f.store.addAccount("cacc1", "alice", "pw", 0)
			row.ExpiresAt = serviceEpoch.Add(time.Hour)
			f.store.insert(row, hashRefreshToken("malformed-token"))

			if _, err := f.svc.Refresh(context.Background(), "malformed-token"); err != ErrUnauthorized {
				t.Fatalf("err = %v, want ErrUnauthorized", err)
			}
			if !f.store.familyRevoked("fam-bad") {
				t.Fatalf("family not revoked")
			}
			if f.log.has("RotateRefreshToken") {
				t.Fatalf("malformed row was rotated")
			}
		})
	}
}

func TestRefreshSessionVersionStoreError(t *testing.T) {
	f := newFixture()
	pair := f.loginMember(t)
	f.store.sessionErr = errors.New("connection reset")
	_, err := f.svc.Refresh(context.Background(), pair.RefreshToken)
	if err == nil || errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want a non-sentinel error", err)
	}
	if len(f.store.revoked) != 0 || f.store.row(t, pair.RefreshToken).RevokedAt != nil {
		t.Fatalf("store error revoked the family (revoked %v)", f.store.revoked)
	}
	if f.log.has("RotateRefreshToken") {
		t.Fatalf("token rotated despite store error")
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
	f.svc.Allowlist = ParseAllowlist("7")
	if _, err := f.svc.Refresh(context.Background(), pair.RefreshToken); err != ErrForbidden {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
	if !f.store.familyRevoked(f.store.row(t, pair.RefreshToken).FamilyID) {
		t.Fatalf("family not revoked")
	}
}

func TestRefreshLostRace(t *testing.T) {
	t.Run("within grace", func(t *testing.T) {
		// Both requests read the row unrevoked; the other one rotates first.
		f := newFixture()
		pair := f.loginMember(t)
		winner := f.store.row(t, pair.RefreshToken)
		f.store.rotateRace = func(oldID string, now time.Time) {
			f.store.revokeID(oldID, now)
			w := winner
			w.ID, w.RevokedAt = "", nil
			f.store.insert(w, "winner-hash")
		}
		got, err := f.svc.Refresh(context.Background(), pair.RefreshToken)
		if err != nil {
			t.Fatalf("lost race within grace: %v", err)
		}
		if len(f.store.revoked) != 0 {
			t.Fatalf("lost race revoked families %v", f.store.revoked)
		}
		row := f.store.row(t, got.RefreshToken)
		if row.FamilyID != winner.FamilyID || row.RevokedAt != nil {
			t.Fatalf("new row %+v, want active row in family %s", row, winner.FamilyID)
		}
	})
	t.Run("family revoked meanwhile", func(t *testing.T) {
		f := newFixture()
		pair := f.loginMember(t)
		family := f.store.row(t, pair.RefreshToken).FamilyID
		f.store.rotateRace = func(_ string, now time.Time) {
			_ = f.store.RevokeFamily(context.Background(), family, now) // e.g. a logout
		}
		n := len(f.store.tokens)
		if _, err := f.svc.Refresh(context.Background(), pair.RefreshToken); err != ErrUnauthorized {
			t.Fatalf("err = %v, want ErrUnauthorized", err)
		}
		if len(f.store.tokens) != n || !f.store.familyRevoked(family) {
			t.Fatalf("a token was issued into the revoked family")
		}
	})
	t.Run("row not revoked", func(t *testing.T) {
		// The store reports a lost race but the row is still active.
		f := newFixture()
		pair := f.loginMember(t)
		f.store.rotateRace = func(string, time.Time) {}
		if _, err := f.svc.Refresh(context.Background(), pair.RefreshToken); err != ErrUnauthorized {
			t.Fatalf("err = %v, want ErrUnauthorized", err)
		}
		if !f.store.familyRevoked(f.store.row(t, pair.RefreshToken).FamilyID) {
			t.Fatalf("family not revoked")
		}
	})
}

func TestRefreshConcurrentWithinGrace(t *testing.T) {
	for _, role := range []string{RoleMember, RoleGuest} {
		t.Run(role, func(t *testing.T) {
			f := newFixture()
			var rt1 TokenPair
			if role == RoleMember {
				rt1 = f.loginMember(t)
			} else {
				var err error
				if rt1, err = f.svc.LoginGuest(context.Background()); err != nil {
					t.Fatalf("LoginGuest: %v", err)
				}
			}
			family := f.store.row(t, rt1.RefreshToken).FamilyID
			rt2, err := f.svc.Refresh(context.Background(), rt1.RefreshToken)
			if err != nil {
				t.Fatalf("Refresh RT1: %v", err)
			}

			// A parallel request still carrying RT1 arrives within the grace.
			f.clock.Advance(10 * time.Second)
			rt3, err := f.svc.Refresh(context.Background(), rt1.RefreshToken)
			if err != nil {
				t.Fatalf("Refresh RT1 within grace: %v", err)
			}
			if rt3.RefreshToken == rt2.RefreshToken || rt3.RefreshToken == rt1.RefreshToken {
				t.Fatalf("grace refresh returned an existing refresh token")
			}
			if len(f.store.revoked) != 0 {
				t.Fatalf("grace refresh revoked families %v", f.store.revoked)
			}
			row3 := f.store.row(t, rt3.RefreshToken)
			if row3.FamilyID != family || row3.RevokedAt != nil {
				t.Fatalf("RT3 row %+v, want active row in family %s", row3, family)
			}
			ttl := RefreshTTL
			if role == RoleGuest {
				ttl = GuestRefreshTTL
			}
			if !row3.ExpiresAt.Equal(f.clock.Now().Add(ttl)) {
				t.Fatalf("RT3 ExpiresAt = %v, want now + %v", row3.ExpiresAt, ttl)
			}
			if got := verifyAccess(t, f, rt3.AccessToken); got.Role != role {
				t.Fatalf("RT3 access role = %q, want %q", got.Role, role)
			}

			// Both tabs keep working.
			if _, err := f.svc.Refresh(context.Background(), rt2.RefreshToken); err != nil {
				t.Fatalf("Refresh RT2: %v", err)
			}
			if _, err := f.svc.Refresh(context.Background(), rt3.RefreshToken); err != nil {
				t.Fatalf("Refresh RT3: %v", err)
			}
		})
	}
}

func TestRefreshReuseAfterGrace(t *testing.T) {
	f := newFixture()
	rt1 := f.loginMember(t)
	family := f.store.row(t, rt1.RefreshToken).FamilyID
	rt2, err := f.svc.Refresh(context.Background(), rt1.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	f.clock.Advance(31 * time.Second)
	if _, err := f.svc.Refresh(context.Background(), rt1.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("reuse after grace err = %v, want ErrUnauthorized", err)
	}
	if !f.store.familyRevoked(family) {
		t.Fatalf("family not revoked after reuse past the grace")
	}
	if _, err := f.svc.Refresh(context.Background(), rt2.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("RT2 after family revoked err = %v, want ErrUnauthorized", err)
	}
}

func TestRefreshReuseAfterFamilyRevoked(t *testing.T) {
	f := newFixture()
	rt1 := f.loginMember(t)
	rt2, err := f.svc.Refresh(context.Background(), rt1.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if err := f.svc.Logout(context.Background(), rt2.RefreshToken); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	f.clock.Advance(5 * time.Second)
	n := len(f.store.tokens)
	if _, err := f.svc.Refresh(context.Background(), rt1.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("RT1 after logout err = %v, want ErrUnauthorized", err)
	}
	if len(f.store.tokens) != n {
		t.Fatalf("a token was issued after logout")
	}
}

func TestRefreshGraceStillChecksRevocation(t *testing.T) {
	f := newFixture()
	rt1 := f.loginMember(t)
	family := f.store.row(t, rt1.RefreshToken).FamilyID
	if _, err := f.svc.Refresh(context.Background(), rt1.RefreshToken); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	f.store.accounts["alice"].SessionVersion++
	f.clock.Advance(time.Second)
	n := len(f.store.tokens)
	if _, err := f.svc.Refresh(context.Background(), rt1.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if len(f.store.tokens) != n {
		t.Fatalf("a token was issued despite the session version change")
	}
	if !f.store.familyRevoked(family) {
		t.Fatalf("family not revoked")
	}
}

func TestRefreshGraceClockSkew(t *testing.T) {
	// A revokedAt in the future (another instance's clock ahead) counts as
	// within the grace only while it is at most RefreshReuseGrace ahead.
	t.Run("within bound", func(t *testing.T) {
		f := newFixture()
		rt1 := f.loginMember(t)
		if _, err := f.svc.Refresh(context.Background(), rt1.RefreshToken); err != nil {
			t.Fatalf("Refresh: %v", err)
		}
		f.clock.Advance(-RefreshReuseGrace)
		if _, err := f.svc.Refresh(context.Background(), rt1.RefreshToken); err != nil {
			t.Fatalf("Refresh with revokedAt %v ahead: %v", RefreshReuseGrace, err)
		}
	})
	t.Run("beyond bound", func(t *testing.T) {
		f := newFixture()
		rt1 := f.loginMember(t)
		family := f.store.row(t, rt1.RefreshToken).FamilyID
		f.clock.Advance(time.Hour)
		if _, err := f.svc.Refresh(context.Background(), rt1.RefreshToken); err != nil {
			t.Fatalf("Refresh: %v", err)
		}
		f.clock.Advance(-RefreshReuseGrace - time.Second)
		if _, err := f.svc.Refresh(context.Background(), rt1.RefreshToken); err != ErrUnauthorized {
			t.Fatalf("err = %v, want ErrUnauthorized", err)
		}
		if !f.store.familyRevoked(family) {
			t.Fatalf("family not revoked")
		}
	})
}

func TestRefreshGraceDoesNotReviveFamilyRevokedByReuse(t *testing.T) {
	f := newFixture()
	rt1 := f.loginMember(t)
	family := f.store.row(t, rt1.RefreshToken).FamilyID
	rt2, err := f.svc.Refresh(context.Background(), rt1.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh RT1: %v", err)
	}
	rt3, err := f.svc.Refresh(context.Background(), rt2.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh RT2: %v", err)
	}
	// RT1 is replayed past the grace: reuse detected, family revoked.
	f.clock.Advance(RefreshReuseGrace + time.Second)
	if _, err := f.svc.Refresh(context.Background(), rt1.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("replay err = %v, want ErrUnauthorized", err)
	}
	// RT3 was revoked just now by that detection, so it is within the grace,
	// but the family is dead and must stay dead.
	f.clock.Advance(5 * time.Second)
	n := len(f.store.tokens)
	for name, tok := range map[string]string{"RT2": rt2.RefreshToken, "RT3": rt3.RefreshToken} {
		if _, err := f.svc.Refresh(context.Background(), tok); err != ErrUnauthorized {
			t.Fatalf("%s err = %v, want ErrUnauthorized", name, err)
		}
	}
	if len(f.store.tokens) != n || !f.store.familyRevoked(family) {
		t.Fatalf("grace request revived the revoked family")
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
		f.svc.Allowlist = ParseAllowlist("7")
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

// --- ChangePassword ------------------------------------------------------

const (
	memberCurrent = "correct horse"
	newPassword12 = "new-password"
)

func memberPrincipal() Principal {
	return Principal{OwnerID: "password:cacc1", Role: RoleMember, SessionVersion: 3}
}

func memberFixture() *fixture {
	f := newFixture()
	f.store.addAccount("cacc1", "alice", memberCurrent, 3)
	return f
}

func TestChangePasswordOrder(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name                   string
		p                      Principal
		current, next, confirm string
		want                   error
	}{
		{"11-rune new password", memberPrincipal(), memberCurrent, "elevenchars", "elevenchars", ErrInvalidNewPassword},
		{"empty new password", memberPrincipal(), memberCurrent, "", "", ErrInvalidNewPassword},
		{"129-rune new password", memberPrincipal(), memberCurrent, strings.Repeat("x", 129), strings.Repeat("x", 129), ErrInvalidNewPassword},
		{"11-rune new password checked before mismatch", memberPrincipal(), memberCurrent, "elevenchars", "other", ErrInvalidNewPassword},
		{"invalid new password checked before current", memberPrincipal(), "wrong", "elevenchars", "elevenchars", ErrInvalidNewPassword},
		{"mismatch", memberPrincipal(), memberCurrent, newPassword12, newPassword12 + "x", ErrPasswordMismatch},
		{"mismatch checked before current", memberPrincipal(), "", newPassword12, "", ErrPasswordMismatch},
		{"admin", Principal{OwnerID: "42", Role: RoleAdmin, Login: "Alice"}, memberCurrent, newPassword12, newPassword12, ErrForbidden},
		{"admin checked before new password", Principal{OwnerID: "42", Role: RoleAdmin, Login: "Alice"}, "", "short", "other", ErrForbidden},
		{"unknown role", Principal{OwnerID: "password:cacc1", Role: "guest"}, memberCurrent, newPassword12, newPassword12, ErrForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := memberFixture()
			err := f.svc.ChangePassword(ctx, tc.p, tc.current, tc.next, tc.confirm)
			if err != tc.want {
				t.Fatalf("err = %v, want exactly %v", err, tc.want)
			}
			if len(f.log.calls) != 0 {
				t.Fatalf("store or hasher called: %v (no attempt may be counted)", f.log.calls)
			}
			if f.store.accounts["alice"].PasswordHash != "hash:"+memberCurrent {
				t.Fatal("password changed")
			}
		})
	}
}

func TestChangePasswordNewPasswordBoundsAndNoTrim(t *testing.T) {
	ctx := context.Background()
	for _, next := range []string{
		strings.Repeat("パ", 12),  // 12 UTF-16 units
		strings.Repeat("x", 128), // upper bound
		strings.Repeat("パ", 128), // 128 UTF-16 units
		"  leading sp",           // whitespace is not trimmed: 12 units
	} {
		f := memberFixture()
		if err := f.svc.ChangePassword(ctx, memberPrincipal(), memberCurrent, next, next); err != nil {
			t.Fatalf("new password %q: err = %v, want nil", next, err)
		}
		if got := f.store.accounts["alice"].PasswordHash; got != "hash:"+next {
			t.Fatalf("stored hash = %q, want the new password's hash (not trimmed)", got)
		}
	}
	f := memberFixture()
	if err := f.svc.ChangePassword(ctx, memberPrincipal(), memberCurrent, " eleven run", " eleven run"); err != ErrInvalidNewPassword {
		t.Fatalf("11 UTF-16 units with a space: err = %v, want ErrInvalidNewPassword", err)
	}
}

// New passwords are measured in UTF-16 code units, like the web's zod
// .min(12).max(128) on a JS string.
func TestChangePasswordNewPasswordLengthIsUTF16Units(t *testing.T) {
	ctx := context.Background()
	emoji6 := strings.Repeat("😀", 6) // 6 runes, 12 UTF-16 units
	f := memberFixture()
	if err := f.svc.ChangePassword(ctx, memberPrincipal(), memberCurrent, emoji6, emoji6); err != nil {
		t.Fatalf("12-unit emoji password: err = %v, want nil", err)
	}
	emoji65 := strings.Repeat("😀", 65) // 65 runes, 130 UTF-16 units
	f = memberFixture()
	if err := f.svc.ChangePassword(ctx, memberPrincipal(), memberCurrent, emoji65, emoji65); err != ErrInvalidNewPassword {
		t.Fatalf("130-unit emoji password: err = %v, want ErrInvalidNewPassword", err)
	}
	if len(f.log.calls) != 0 {
		t.Fatalf("store or hasher called: %v", f.log.calls)
	}
}

func TestChangePasswordUniformFailures(t *testing.T) {
	cases := []struct {
		name        string
		ownerID     string
		current     string
		throttled   bool // the password-change key is already at the limit
		wantConsume bool
	}{
		{name: "account missing", ownerID: "password:cnobody", current: memberCurrent},
		{name: "owner without prefix", ownerID: "cacc1", current: memberCurrent},
		{name: "empty owner id", ownerID: "password:", current: memberCurrent},
		{name: "empty current password", ownerID: "password:cacc1", current: "", wantConsume: true},
		{name: "129-rune current password", ownerID: "password:cacc1", current: strings.Repeat("x", 129), wantConsume: true},
		{name: "129-rune multibyte current password", ownerID: "password:cacc1", current: strings.Repeat("パ", 129), wantConsume: true},
		{name: "too many tries", ownerID: "password:cacc1", current: memberCurrent, throttled: true, wantConsume: true},
		{name: "wrong password", ownerID: "password:cacc1", current: "wrong", wantConsume: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := memberFixture()
			if tc.throttled {
				f.store.throttle["password-change:cacc1"] = &throttleEntry{count: maxFailuresPerLogin, expires: serviceEpoch.Add(time.Minute)}
			}
			p := Principal{OwnerID: tc.ownerID, Role: RoleMember, SessionVersion: 3}

			err := f.svc.ChangePassword(context.Background(), p, tc.current, newPassword12, newPassword12)
			if err != ErrInvalidCurrentPassword {
				t.Fatalf("err = %v, want exactly ErrInvalidCurrentPassword", err)
			}
			if f.hasher.count != 1 {
				t.Fatalf("hash computations = %d, want 1 (calls %v)", f.hasher.count, f.log.calls)
			}
			for _, pw := range f.hasher.passwords {
				if utf8.RuneCountInString(pw) > 128 {
					t.Fatalf("hasher got a %d-rune password", utf8.RuneCountInString(pw))
				}
			}
			if f.log.has("SetPassword") || f.log.has("Hash") || f.log.has("ResetThrottle") {
				t.Fatalf("failure changed the account (calls %v)", f.log.calls)
			}
			if got := f.log.has("ConsumeThrottle"); got != tc.wantConsume {
				t.Fatalf("ConsumeThrottle called = %v, want %v (calls %v)", got, tc.wantConsume, f.log.calls)
			}
			if tc.wantConsume && !slices.Equal(f.store.consumed, []string{"password-change:cacc1"}) {
				t.Fatalf("consumed = %v, want only the password-change key", f.store.consumed)
			}
			if f.store.accounts["alice"].PasswordHash != "hash:"+memberCurrent || f.store.accounts["alice"].SessionVersion != 3 {
				t.Fatal("password or session version changed")
			}
		})
	}
}

func TestChangePasswordSuccess(t *testing.T) {
	f := memberFixture()
	if err := f.svc.ChangePassword(context.Background(), memberPrincipal(), memberCurrent, newPassword12, newPassword12); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	want := []string{"FindPasswordAccountByID", "ConsumeThrottle", "Verify", "Hash", "SetPassword", "ResetThrottle"}
	if !slices.Equal(f.log.calls, want) {
		t.Fatalf("calls = %v, want %v", f.log.calls, want)
	}
	if !slices.Equal(f.store.resets, []string{"password-change:cacc1"}) {
		t.Fatalf("resets = %v, want the password-change key", f.store.resets)
	}
	if !slices.Equal(f.hasher.passwords, []string{memberCurrent}) {
		t.Fatalf("verified passwords = %q, want only the current one", f.hasher.passwords)
	}
	a := f.store.accounts["alice"]
	if a.PasswordHash != "hash:"+newPassword12 || a.SessionVersion != 4 {
		t.Fatalf("account = %+v, want the new hash and session version 4", *a)
	}
	if len(f.store.setPasswordAt) != 1 || !f.store.setPasswordAt[0].Equal(serviceEpoch) {
		t.Fatalf("SetPassword now = %v, want %v", f.store.setPasswordAt, serviceEpoch)
	}
}

func TestChangePasswordRevokesSessions(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	pair := f.loginMember(t)
	p, err := f.svc.Authenticate(ctx, pair.AccessToken)
	if err != nil {
		t.Fatalf("Authenticate before change: %v", err)
	}

	if err := f.svc.ChangePassword(ctx, p, "correct horse", newPassword12, newPassword12); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	if _, err := f.svc.Authenticate(ctx, pair.AccessToken); err != ErrUnauthorized {
		t.Fatalf("old access token: err = %v, want ErrUnauthorized", err)
	}
	if _, err := f.svc.Refresh(ctx, pair.RefreshToken); err != ErrUnauthorized {
		t.Fatalf("old refresh token: err = %v, want ErrUnauthorized", err)
	}
	if _, err := f.svc.LoginPassword(ctx, testClient, "alice", "correct horse"); err != ErrUnauthorized {
		t.Fatalf("login with the old password: err = %v, want ErrUnauthorized", err)
	}
	if _, err := f.svc.LoginPassword(ctx, testClient, "alice", newPassword12); err != nil {
		t.Fatalf("login with the new password: %v", err)
	}
}

func TestChangePasswordInfrastructureErrors(t *testing.T) {
	ctx := context.Background()
	const secret = "s3cret-current"
	const secretNew = "s3cret-new-password"

	check := func(t *testing.T, err error) {
		t.Helper()
		for _, sentinel := range []error{ErrInvalidCurrentPassword, ErrInvalidNewPassword, ErrPasswordMismatch, ErrUnauthorized, ErrForbidden} {
			if errors.Is(err, sentinel) {
				t.Fatalf("err = %v, want a non-sentinel error", err)
			}
		}
		if err == nil || strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), secretNew) {
			t.Fatalf("err = %v, want an error without passwords", err)
		}
	}

	t.Run("find account", func(t *testing.T) {
		f := memberFixture()
		f.store.findAccountErr = errors.New("connection reset")
		err := f.svc.ChangePassword(ctx, memberPrincipal(), secret, secretNew, secretNew)
		check(t, err)
		if f.log.has("SetPassword") {
			t.Fatal("SetPassword called")
		}
	})

	for _, tc := range []struct{ name, ownerID, current string }{
		{"simulate (account missing)", "password:cnobody", secret},
		{"simulate (bad current)", "password:cacc1", ""},
		{"verify", "password:cacc1", secret},
	} {
		t.Run("hasher "+tc.name, func(t *testing.T) {
			f := memberFixture()
			f.hasher.err = context.Canceled
			p := Principal{OwnerID: tc.ownerID, Role: RoleMember, SessionVersion: 3}
			err := f.svc.ChangePassword(ctx, p, tc.current, secretNew, secretNew)
			check(t, err)
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("err = %v, want a wrapped context.Canceled", err)
			}
			if f.log.has("SetPassword") {
				t.Fatal("SetPassword called")
			}
		})
	}

	t.Run("hash", func(t *testing.T) {
		f := memberFixture()
		f.hasher.hashErr = context.DeadlineExceeded
		err := f.svc.ChangePassword(ctx, memberPrincipal(), memberCurrent, secretNew, secretNew)
		check(t, err)
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("err = %v, want a wrapped DeadlineExceeded", err)
		}
		if f.log.has("SetPassword") {
			t.Fatal("SetPassword called after Hash failed")
		}
	})

	t.Run("set password", func(t *testing.T) {
		f := memberFixture()
		f.store.setPasswordErr = errors.New("connection reset")
		check(t, f.svc.ChangePassword(ctx, memberPrincipal(), memberCurrent, secretNew, secretNew))
	})

	t.Run("account deleted before set password", func(t *testing.T) {
		f := memberFixture()
		f.store.setPasswordErr = store.ErrNotFound
		err := f.svc.ChangePassword(ctx, memberPrincipal(), memberCurrent, secretNew, secretNew)
		if err != ErrInvalidCurrentPassword {
			t.Fatalf("err = %v, want ErrInvalidCurrentPassword", err)
		}
	})
}

// --- LoginGuest and Me ----------------------------------------------------

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

func TestMeMember(t *testing.T) {
	f := newFixture()
	acc := f.store.addAccount("cacc1", "alice", "pw", 3)
	acc.DisplayName = "Alice A"
	got, err := f.svc.Me(context.Background(), Principal{OwnerID: "password:cacc1", Role: RoleMember, SessionVersion: 3})
	want := Me{OwnerID: "password:cacc1", Role: RoleMember, Login: "alice", DisplayName: "Alice A", AccountID: "cacc1"}
	if err != nil || got != want {
		t.Fatalf("Me = %+v, %v; want %+v", got, err, want)
	}
}

func TestMeMemberMissing(t *testing.T) {
	f := newFixture()
	_, err := f.svc.Me(context.Background(), Principal{OwnerID: "password:gone", Role: RoleMember})
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	_, err = f.svc.Me(context.Background(), Principal{OwnerID: "nope", Role: RoleMember})
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("malformed owner err = %v, want ErrUnauthorized", err)
	}
}

func TestMeAdminAndGuest(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	got, err := f.svc.Me(ctx, Principal{OwnerID: "42", Role: RoleAdmin, Login: "Alice"})
	if want := (Me{OwnerID: "42", Role: RoleAdmin, Login: "Alice"}); err != nil || got != want {
		t.Fatalf("admin Me = %+v, %v; want %+v", got, err, want)
	}
	got, err = f.svc.Me(ctx, Principal{OwnerID: GuestOwnerID, Role: RoleGuest})
	if want := (Me{OwnerID: "guest", Role: "guest", Login: "guest"}); err != nil || got != want {
		t.Fatalf("guest Me = %+v, %v; want %+v", got, err, want)
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

func TestActAs(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	acc := f.store.addAccount("cacc1", "test01", "pw", 0)
	acc.DisplayName = "テスト"
	admin := Principal{OwnerID: "42", Role: RoleAdmin, Login: "Alice"}

	got, err := f.svc.ActAs(ctx, admin, "password:cacc1")
	want := Principal{OwnerID: "password:cacc1", Role: RoleAdmin, Login: "Alice", ActorID: "42"}
	if err != nil || got != want {
		t.Fatalf("ActAs = %+v, %v; want %+v", got, err, want)
	}

	me, err := f.svc.Me(ctx, got)
	wantMe := Me{OwnerID: "password:cacc1", Role: RoleAdmin, Login: "Alice",
		ActingAs: ActingAs{OwnerID: "password:cacc1", LoginID: "test01", DisplayName: "テスト"}}
	if err != nil || me != wantMe {
		t.Fatalf("Me while acting = %+v, %v; want %+v", me, err, wantMe)
	}

	if _, err := f.svc.ActAs(ctx, admin, "password:gone"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("missing member err = %v, want store.ErrNotFound", err)
	}
	if _, err := f.svc.ActAs(ctx, admin, "42"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("admin owner id err = %v, want store.ErrNotFound", err)
	}
	member := Principal{OwnerID: "password:cacc1", Role: RoleMember}
	if _, err := f.svc.ActAs(ctx, member, "password:cacc1"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member err = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.ActAs(ctx, got, "password:cacc1"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("acting twice err = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.Me(ctx, Principal{OwnerID: "password:gone", Role: RoleAdmin, ActorID: "42"}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("Me for a vanished member err = %v, want store.ErrNotFound", err)
	}
}

// --- FFPF ID -------------------------------------------------------------

// ffpfAccounts returns the fake store's FFPF ID accounts by sub, creating
// the map on first use.
func (f *fakeStore) ffpfAccounts() map[string]*store.FfpfAccount {
	if f.ffpf == nil {
		f.ffpf = map[string]*store.FfpfAccount{}
	}
	return f.ffpf
}

// UpsertFfpfAccount mirrors the store: it creates the account with session
// version 0 or updates its email and display name, keeping the version.
func (f *fakeStore) UpsertFfpfAccount(_ context.Context, a store.FfpfAccount, _ time.Time) (store.FfpfAccount, error) {
	f.log.add("UpsertFfpfAccount")
	if f.upsertFfpfErr != nil {
		return store.FfpfAccount{}, f.upsertFfpfErr
	}
	accounts := f.ffpfAccounts()
	cur, ok := accounts[a.ID]
	if !ok {
		cur = &store.FfpfAccount{ID: a.ID}
		accounts[a.ID] = cur
	}
	cur.Email, cur.DisplayName = a.Email, a.DisplayName
	return *cur, nil
}

func (f *fakeStore) FindFfpfAccount(_ context.Context, id string) (store.FfpfAccount, error) {
	f.log.add("FindFfpfAccount")
	if f.findAccountErr != nil {
		return store.FfpfAccount{}, f.findAccountErr
	}
	a, ok := f.ffpfAccounts()[id]
	if !ok {
		return store.FfpfAccount{}, store.ErrNotFound
	}
	return *a, nil
}

func (f *fakeStore) FfpfSessionVersion(_ context.Context, id string) (int, error) {
	f.log.add("FfpfSessionVersion")
	if f.sessionErr != nil {
		return 0, f.sessionErr
	}
	a, ok := f.ffpfAccounts()[id]
	if !ok {
		return 0, store.ErrNotFound
	}
	return a.SessionVersion, nil
}

type stubFFPF struct {
	user                               FFPFUser
	err                                error
	code, verifier, redirectURI, nonce string
}

func (s *stubFFPF) Exchange(_ context.Context, code, verifier, redirectURI, nonce string) (FFPFUser, error) {
	s.code, s.verifier, s.redirectURI, s.nonce = code, verifier, redirectURI, nonce
	return s.user, s.err
}

func ffpfFixture() (*fixture, *stubFFPF) {
	f := newFixture()
	stub := &stubFFPF{user: FFPFUser{Sub: "cabc", Email: "alice@example.com", Name: "Alice"}}
	f.svc.FFPF = stub
	return f, stub
}

func (f *fixture) loginFFPF(t *testing.T) TokenPair {
	t.Helper()
	pair, err := f.svc.LoginFFPF(context.Background(), "code", "verifier", "https://zl.example/cb", "nonce1")
	if err != nil {
		t.Fatalf("LoginFFPF: %v", err)
	}
	return pair
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
	t.Run("upsert error", func(t *testing.T) {
		f, _ := ffpfFixture()
		f.store.upsertFfpfErr = errors.New("connection reset")
		_, err := f.svc.LoginFFPF(ctx, "c", "v", "r", "n")
		if err == nil || errors.Is(err, ErrUnauthorized) || len(f.store.tokens) != 0 {
			t.Fatalf("err = %v, tokens %d; want a non-sentinel error and no token", err, len(f.store.tokens))
		}
	})
}

func TestFFPFRevocation(t *testing.T) {
	ctx := context.Background()

	t.Run("refresh succeeds while the version matches", func(t *testing.T) {
		f, _ := ffpfFixture()
		pair := f.loginFFPF(t)
		next, err := f.svc.Refresh(ctx, pair.RefreshToken)
		if err != nil {
			t.Fatalf("Refresh: %v", err)
		}
		p, err := f.svc.Authenticate(ctx, next.AccessToken)
		if err != nil || p.OwnerID != "ffpf:cabc" || p.Role != RoleMember {
			t.Fatalf("Authenticate = %+v, %v", p, err)
		}
		me, err := f.svc.Me(ctx, p)
		if err != nil || me.Login != "alice@example.com" || me.DisplayName != "Alice" {
			t.Fatalf("Me after refresh = %+v, %v", me, err)
		}
	})
	t.Run("bumped version revokes access and refresh", func(t *testing.T) {
		f, _ := ffpfFixture()
		pair := f.loginFFPF(t)
		f.store.ffpf["cabc"].SessionVersion = 1
		if _, err := f.svc.Authenticate(ctx, pair.AccessToken); err != ErrUnauthorized {
			t.Fatalf("Authenticate err = %v, want ErrUnauthorized", err)
		}
		if _, err := f.svc.Refresh(ctx, pair.RefreshToken); err != ErrUnauthorized {
			t.Fatalf("Refresh err = %v, want ErrUnauthorized", err)
		}
		if !f.store.familyRevoked(f.store.row(t, pair.RefreshToken).FamilyID) {
			t.Fatal("family not revoked")
		}
	})
	t.Run("deleted account", func(t *testing.T) {
		f, _ := ffpfFixture()
		pair := f.loginFFPF(t)
		delete(f.store.ffpf, "cabc")
		if _, err := f.svc.Authenticate(ctx, pair.AccessToken); err != ErrUnauthorized {
			t.Fatalf("Authenticate err = %v, want ErrUnauthorized", err)
		}
		if _, err := f.svc.Me(ctx, Principal{OwnerID: "ffpf:cabc", Role: RoleMember}); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("Me err = %v, want ErrUnauthorized", err)
		}
	})
	t.Run("store error propagates", func(t *testing.T) {
		f, _ := ffpfFixture()
		pair := f.loginFFPF(t)
		f.store.sessionErr = errors.New("connection reset")
		_, err := f.svc.Authenticate(ctx, pair.AccessToken)
		if err == nil || errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrForbidden) {
			t.Fatalf("err = %v, want a non-sentinel error", err)
		}
	})
	t.Run("the version is read from the FFPF table only", func(t *testing.T) {
		f, _ := ffpfFixture()
		pair := f.loginFFPF(t)
		// A password account whose id equals the sub must not matter.
		f.store.addAccount("cabc", "cabc", "pw", 7)
		if _, err := f.svc.Authenticate(ctx, pair.AccessToken); err != nil {
			t.Fatalf("Authenticate: %v", err)
		}
		if f.log.has("SessionVersion") {
			t.Fatal("the password session version was read for an ffpf: principal")
		}
	})
	t.Run("member owner with another prefix or an empty sub", func(t *testing.T) {
		f, _ := ffpfFixture()
		for _, owner := range []string{"ffpf:", "github:cabc", "cabc"} {
			tok, err := f.svc.Signer.Issue(Principal{OwnerID: owner, Role: RoleMember})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.svc.Authenticate(ctx, tok); err != ErrUnauthorized {
				t.Fatalf("%s: err = %v, want ErrUnauthorized", owner, err)
			}
		}
	})
}

func TestFFPFMemberCannotUsePasswordFeatures(t *testing.T) {
	f, _ := ffpfFixture()
	ctx := context.Background()
	f.loginFFPF(t)
	p := Principal{OwnerID: "ffpf:cabc", Role: RoleMember}
	if err := f.svc.ChangePassword(ctx, p, "whatever", newPassword12, newPassword12); !errors.Is(err, ErrForbidden) {
		t.Fatalf("ChangePassword err = %v, want ErrForbidden", err)
	}
	if f.hasher.count != 0 || f.log.has("ConsumeThrottle") {
		t.Fatal("ChangePassword did password work for an ffpf: member")
	}
	admin := Principal{OwnerID: "42", Role: RoleAdmin, Login: "Alice"}
	if _, err := f.svc.ActAs(ctx, admin, "ffpf:cabc"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("ActAs err = %v, want store.ErrNotFound", err)
	}
}
