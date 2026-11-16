// Shared fakes and fixtures for the Service tests (login, session, me,
// password change, demo).
package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type testClock struct{ t time.Time }

func (c *testClock) Now() time.Time { return c.t }

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
