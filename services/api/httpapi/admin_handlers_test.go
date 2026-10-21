package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type fakeAccounts struct {
	accounts []store.AccountSummary
	taken    map[string]bool
	hashes   map[string]string // id -> last hash
	setCalls []string          // ids passed to SetPassword
	created  []string          // hashes passed to CreatePasswordAccount
	listNow  time.Time
}

func newFakeAccounts() *fakeAccounts {
	return &fakeAccounts{taken: map[string]bool{}, hashes: map[string]string{}}
}

func (f *fakeAccounts) ListPasswordAccounts(_ context.Context, now time.Time) ([]store.AccountSummary, error) {
	f.listNow = now
	return f.accounts, nil
}

func (f *fakeAccounts) CreatePasswordAccount(_ context.Context, loginID, displayName, hash string, now time.Time) (store.AccountSummary, error) {
	if f.taken[loginID] {
		return store.AccountSummary{}, store.ErrLoginIDTaken
	}
	f.created = append(f.created, hash)
	a := store.AccountSummary{ID: "cnew" + loginID, LoginID: loginID, DisplayName: displayName, CreatedAt: now}
	f.accounts = append(f.accounts, a)
	f.hashes[a.ID] = hash
	return a, nil
}

func (f *fakeAccounts) FindPasswordAccountByID(_ context.Context, id string) (store.PasswordAccount, error) {
	for _, a := range f.accounts {
		if a.ID == id {
			return store.PasswordAccount{ID: a.ID, LoginID: a.LoginID}, nil
		}
	}
	return store.PasswordAccount{}, store.ErrNotFound
}

func (f *fakeAccounts) SetPassword(_ context.Context, id, hash string, _ time.Time) error {
	for _, a := range f.accounts {
		if a.ID == id {
			f.setCalls = append(f.setCalls, id)
			f.hashes[id] = hash
			return nil
		}
	}
	return store.ErrNotFound
}

type fakeHasher struct{}

func (fakeHasher) Hash(_ context.Context, password string) (string, error) {
	return "hash(" + password + ")", nil
}

func adminRouter(t *testing.T, acc Accounts, role string) (http.Handler, *bytes.Buffer) {
	t.Helper()
	buf := &bytes.Buffer{}
	a := &fakeAuth{authenticate: func(_ context.Context, tok string) (auth.Principal, error) {
		if tok != "tok" {
			return auth.Principal{}, auth.ErrUnauthorized
		}
		return auth.Principal{OwnerID: testOwner, Role: role}, nil
	}}
	return NewRouter(Deps{Auth: a, Accounts: acc, Hasher: fakeHasher{}, Logger: slog.New(slog.NewJSONHandler(buf, nil)), Now: newClock().Now}), buf
}

type accountResp struct {
	ID          string `json:"id"`
	OwnerID     string `json:"ownerId"`
	LoginID     string `json:"loginId"`
	DisplayName string `json:"displayName"`
	CreatedAt   string `json:"createdAt"`
	Locked      bool   `json:"locked"`
}

type createResp struct {
	Account   accountResp `json:"account"`
	Password  string      `json:"password"`
	Generated bool        `json:"generated"`
}

func TestAdminRoutesRequireAdmin(t *testing.T) {
	routes := []struct{ method, target, body string }{
		{http.MethodGet, "/v1/admin/accounts", ""},
		{http.MethodPost, "/v1/admin/accounts", `{"loginId":"abc","displayName":"x"}`},
		{http.MethodPost, "/v1/admin/accounts/cx/password", `{}`},
	}
	for _, rt := range routes {
		t.Run(rt.method+" "+rt.target, func(t *testing.T) {
			h, _ := adminRouter(t, newFakeAccounts(), auth.RoleMember)
			w := do(h, rt.method, rt.target, rt.body, authHeader)
			wantError(t, w, http.StatusForbidden, "forbidden")
			if got := decodeError(t, w).Error.Message; got != "管理者だけが利用できます。" {
				t.Fatalf("message = %q", got)
			}
			h, _ = adminRouter(t, newFakeAccounts(), auth.RoleAdmin)
			wantError(t, do(h, rt.method, rt.target, rt.body, nil), http.StatusUnauthorized, "unauthorized")
			if w := do(h, rt.method, rt.target+"?user=1", rt.body, authHeader); w.Code != http.StatusBadRequest {
				t.Fatalf("?user= status = %d, want 400", w.Code)
			}
		})
	}
}

func TestAdminListAccounts(t *testing.T) {
	acc := newFakeAccounts()
	at := time.Date(2026, 10, 1, 2, 3, 4, 5_000_000, time.UTC)
	acc.accounts = []store.AccountSummary{
		{ID: "ca", LoginID: "alice", DisplayName: "Alice", CreatedAt: at, Locked: true},
		{ID: "cb", LoginID: "bob", DisplayName: "Bob", CreatedAt: at.Add(time.Hour)},
	}
	h, _ := adminRouter(t, acc, auth.RoleAdmin)
	w := do(h, http.MethodGet, "/v1/admin/accounts", "", authHeader)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Accounts []accountResp `json:"accounts"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	want := []accountResp{
		{ID: "ca", OwnerID: "password:ca", LoginID: "alice", DisplayName: "Alice", CreatedAt: "2026-10-01T02:03:04.005Z", Locked: true},
		{ID: "cb", OwnerID: "password:cb", LoginID: "bob", DisplayName: "Bob", CreatedAt: "2026-10-01T03:03:04.005Z"},
	}
	if len(resp.Accounts) != 2 || resp.Accounts[0] != want[0] || resp.Accounts[1] != want[1] {
		t.Fatalf("accounts = %+v, want %+v", resp.Accounts, want)
	}
	if !acc.listNow.Equal(newClock().Now()) {
		t.Fatalf("list now = %v", acc.listNow)
	}
	if strings.Contains(w.Body.String(), "hash") || strings.Contains(w.Body.String(), "failed") {
		t.Fatalf("body leaks internals: %s", w.Body.String())
	}

	// An empty list is [] not null.
	h, _ = adminRouter(t, newFakeAccounts(), auth.RoleAdmin)
	if w := do(h, http.MethodGet, "/v1/admin/accounts", "", authHeader); strings.TrimSpace(w.Body.String()) != `{"accounts":[]}` {
		t.Fatalf("empty body = %s", w.Body.String())
	}
}

func TestAdminCreateAccount(t *testing.T) {
	long := strings.Repeat("あ", 12)  // 12 runes, 36 bytes
	emoji6 := strings.Repeat("😀", 6) // 6 runes, 12 UTF-16 units
	cases := []struct {
		name, body    string
		wantPassword  string // "" = generated
		wantGenerated bool
	}{
		{"missing", `{"loginId":"  Alice.W ","displayName":"  Alice  "}`, "", true},
		{"empty", `{"loginId":"alice.w","displayName":"Alice","password":""}`, "", true},
		{"whitespace only", `{"loginId":"alice.w","displayName":"Alice","password":"   \t "}`, "", true},
		{"given", `{"loginId":"alice.w","displayName":"Alice","password":"  keep spaces 1 "}`, "  keep spaces 1 ", false},
		{"multibyte", `{"loginId":"alice.w","displayName":"Alice","password":"` + long + `"}`, long, false},
		{"emoji, 12 UTF-16 units", `{"loginId":"alice.w","displayName":"Alice","password":"` + emoji6 + `"}`, emoji6, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			acc := newFakeAccounts()
			h, _ := adminRouter(t, acc, auth.RoleAdmin)
			w := do(h, http.MethodPost, "/v1/admin/accounts", c.body, authHeader)
			if w.Code != http.StatusCreated {
				t.Fatalf("status = %d: %s", w.Code, w.Body.String())
			}
			var resp createResp
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatal(err)
			}
			if resp.Account.LoginID != "alice.w" || resp.Account.DisplayName != "Alice" || resp.Account.Locked ||
				resp.Account.OwnerID != "password:"+resp.Account.ID || resp.Account.CreatedAt != "2026-10-20T12:00:00.000Z" {
				t.Fatalf("account = %+v", resp.Account)
			}
			if resp.Generated != c.wantGenerated {
				t.Fatalf("generated = %v", resp.Generated)
			}
			if c.wantGenerated {
				if len(resp.Password) != 20 {
					t.Fatalf("generated password = %q", resp.Password)
				}
			} else if resp.Password != c.wantPassword {
				t.Fatalf("password = %q, want %q", resp.Password, c.wantPassword)
			}
			if len(acc.created) != 1 || acc.created[0] != "hash("+resp.Password+")" {
				t.Fatalf("stored hash = %v for password %q", acc.created, resp.Password)
			}
		})
	}
}

func TestAdminCreateAccountValidation(t *testing.T) {
	const (
		loginMsg = "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。"
		nameMsg  = "表示名は1〜50文字にしてください。"
		passMsg  = "パスワードは12〜128文字にしてください。"
	)
	q := func(s string) string { b, _ := json.Marshal(s); return string(b) }
	cases := []struct {
		name, body, msg string
	}{
		{"login too short", `{"loginId":"ab","displayName":"x"}`, loginMsg},
		{"login too long", `{"loginId":"` + strings.Repeat("a", 33) + `","displayName":"x"}`, loginMsg},
		{"login bad char", `{"loginId":"ab cd","displayName":"x"}`, loginMsg},
		{"login non-ascii", `{"loginId":"あいう","displayName":"x"}`, loginMsg},
		{"login missing", `{"displayName":"x"}`, loginMsg},
		{"name empty", `{"loginId":"abc","displayName":"   "}`, nameMsg},
		{"name missing", `{"loginId":"abc"}`, nameMsg},
		{"name too long", `{"loginId":"abc","displayName":` + q(strings.Repeat("あ", 51)) + `}`, nameMsg},
		{"password short", `{"loginId":"abc","displayName":"x","password":"12345678901"}`, passMsg},
		{"password short multibyte", `{"loginId":"abc","displayName":"x","password":` + q(strings.Repeat("あ", 11)) + `}`, passMsg},
		{"password long", `{"loginId":"abc","displayName":"x","password":` + q(strings.Repeat("a", 129)) + `}`, passMsg},
		{"password long emoji", `{"loginId":"abc","displayName":"x","password":` + q(strings.Repeat("😀", 65)) + `}`, passMsg},
		{"name too long emoji", `{"loginId":"abc","displayName":` + q(strings.Repeat("😀", 26)) + `}`, nameMsg},
		{"login dotted capital I", `{"loginId":` + q(string(rune(0x0130))+"abc") + `,"displayName":"x"}`, loginMsg},
		{"login before name", `{"loginId":"!","displayName":""}`, loginMsg},
		{"name before password", `{"loginId":"abc","displayName":"","password":"x"}`, nameMsg},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			acc := newFakeAccounts()
			h, _ := adminRouter(t, acc, auth.RoleAdmin)
			w := do(h, http.MethodPost, "/v1/admin/accounts", c.body, authHeader)
			wantError(t, w, http.StatusBadRequest, "invalid_request")
			if got := decodeError(t, w).Error.Message; got != c.msg {
				t.Fatalf("message = %q, want %q", got, c.msg)
			}
			if len(acc.created) != 0 {
				t.Fatal("account created despite invalid input")
			}
		})
	}
	// Boundaries pass.
	acc := newFakeAccounts()
	h, _ := adminRouter(t, acc, auth.RoleAdmin)
	for _, body := range []string{
		`{"loginId":"a.-","displayName":"x","password":"123456789012"}`,
		`{"loginId":"` + strings.Repeat("z", 32) + `","displayName":` + q(strings.Repeat("あ", 50)) + `,"password":` + q(strings.Repeat("a", 128)) + `}`,
		`{"loginId":"emoji","displayName":` + q(strings.Repeat("😀", 25)) + `,"password":` + q(strings.Repeat("😀", 64)) + `}`,
	} {
		if w := do(h, http.MethodPost, "/v1/admin/accounts", body, authHeader); w.Code != http.StatusCreated {
			t.Fatalf("boundary %s: status %d: %s", body, w.Code, w.Body.String())
		}
	}
	// Malformed bodies are plain 400s.
	for _, body := range []string{`{`, `[]`, `{"loginId":null,"displayName":"x"}`, `{"loginId":"abc","displayName":"x","extra":1}`} {
		wantError(t, do(h, http.MethodPost, "/v1/admin/accounts", body, authHeader), http.StatusBadRequest, "invalid_request")
	}
}

// loginId is lowercased like JS toLowerCase: the Kelvin sign becomes "k".
func TestAdminCreateAccountKelvinSign(t *testing.T) {
	acc := newFakeAccounts()
	h, _ := adminRouter(t, acc, auth.RoleAdmin)
	body, _ := json.Marshal(map[string]string{"loginId": string(rune(0x212A)) + "abc", "displayName": "K"})
	w := do(h, http.MethodPost, "/v1/admin/accounts", string(body), authHeader)
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var resp createResp
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Account.LoginID != "kabc" {
		t.Fatalf("loginId = %q, want kabc", resp.Account.LoginID)
	}
}

func TestAdminCreateAccountDuplicate(t *testing.T) {
	acc := newFakeAccounts()
	acc.taken["alice"] = true
	h, _ := adminRouter(t, acc, auth.RoleAdmin)
	w := do(h, http.MethodPost, "/v1/admin/accounts", `{"loginId":"ALICE","displayName":"A"}`, authHeader)
	wantError(t, w, http.StatusConflict, "login_id_taken")
	if got := decodeError(t, w).Error.Message; got != "このログインIDはすでに使われています。" {
		t.Fatalf("message = %q", got)
	}
}

func TestAdminResetPassword(t *testing.T) {
	cases := []struct {
		name, body, wantPassword string
		generated                bool
	}{
		{"empty object", `{}`, "", true},
		{"blank", `{"password":"  "}`, "", true},
		{"given", `{"password":"a brand new pw"}`, "a brand new pw", false},
		{"emoji, 12 UTF-16 units", `{"password":"😀😀😀😀😀😀"}`, "😀😀😀😀😀😀", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			acc := newFakeAccounts()
			acc.accounts = []store.AccountSummary{{ID: "cx", LoginID: "alice"}}
			h, _ := adminRouter(t, acc, auth.RoleAdmin)
			w := do(h, http.MethodPost, "/v1/admin/accounts/cx/password", c.body, authHeader)
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d: %s", w.Code, w.Body.String())
			}
			var resp struct {
				LoginID   string `json:"loginId"`
				Password  string `json:"password"`
				Generated bool   `json:"generated"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatal(err)
			}
			if resp.LoginID != "alice" || resp.Generated != c.generated {
				t.Fatalf("resp = %+v", resp)
			}
			if c.generated && len(resp.Password) != 20 {
				t.Fatalf("generated password = %q", resp.Password)
			} else if !c.generated && resp.Password != c.wantPassword {
				t.Fatalf("password = %q", resp.Password)
			}
			// SetPassword (which bumps sessionVersion, revoking old tokens)
			// ran once with the hash of the returned password.
			if len(acc.setCalls) != 1 || acc.setCalls[0] != "cx" || acc.hashes["cx"] != "hash("+resp.Password+")" {
				t.Fatalf("setCalls=%v hashes=%v", acc.setCalls, acc.hashes)
			}
		})
	}
}

func TestAdminResetPasswordErrors(t *testing.T) {
	acc := newFakeAccounts()
	acc.accounts = []store.AccountSummary{{ID: "cx", LoginID: "alice"}}
	h, _ := adminRouter(t, acc, auth.RoleAdmin)

	w := do(h, http.MethodPost, "/v1/admin/accounts/cmissing/password", `{}`, authHeader)
	wantError(t, w, http.StatusNotFound, "not_found")
	if got := decodeError(t, w).Error.Message; got != "アカウントが見つかりません。" {
		t.Fatalf("message = %q", got)
	}

	for _, pw := range []string{"short", strings.Repeat("😀", 65)} {
		body, _ := json.Marshal(map[string]string{"password": pw})
		w = do(h, http.MethodPost, "/v1/admin/accounts/cx/password", string(body), authHeader)
		wantError(t, w, http.StatusBadRequest, "invalid_request")
		if got := decodeError(t, w).Error.Message; got != "パスワードは12〜128文字にしてください。" {
			t.Fatalf("%q: message = %q", pw, got)
		}
	}
	if len(acc.setCalls) != 0 {
		t.Fatal("password changed despite invalid input")
	}
	wantError(t, do(h, http.MethodPost, "/v1/admin/accounts/cx/password", `{"x":1}`, authHeader), http.StatusBadRequest, "invalid_request")
	wantError(t, do(h, http.MethodPost, "/v1/admin/accounts/cx/password", ``, authHeader), http.StatusBadRequest, "invalid_request")
}

func TestAdminAccountsLogsOmitPasswords(t *testing.T) {
	const supplied = "supplied-secret-pw-9876"
	acc := newFakeAccounts()
	acc.accounts = []store.AccountSummary{{ID: "cx", LoginID: "alice"}}
	h, logs := adminRouter(t, acc, auth.RoleAdmin)

	var generated []string
	collect := func(w interface{ Bytes() []byte }) {
		var r struct {
			Password string `json:"password"`
		}
		_ = json.Unmarshal(w.Bytes(), &r)
		if r.Password != "" {
			generated = append(generated, r.Password)
		}
	}
	w := do(h, http.MethodPost, "/v1/admin/accounts", `{"loginId":"bob","displayName":"B"}`, authHeader)
	collect(w.Body)
	w = do(h, http.MethodPost, "/v1/admin/accounts", `{"loginId":"carol","displayName":"C","password":"`+supplied+`"}`, authHeader)
	collect(w.Body)
	w = do(h, http.MethodPost, "/v1/admin/accounts/cx/password", `{}`, authHeader)
	collect(w.Body)
	w = do(h, http.MethodPost, "/v1/admin/accounts/cx/password", `{"password":"`+supplied+`"}`, authHeader)
	collect(w.Body)
	// Failure paths log too.
	acc.taken["dave"] = true
	do(h, http.MethodPost, "/v1/admin/accounts", `{"loginId":"dave","displayName":"D","password":"`+supplied+`"}`, authHeader)

	if len(generated) != 4 {
		t.Fatalf("collected %d passwords", len(generated))
	}
	if logs.Len() == 0 {
		t.Fatal("expected request log output")
	}
	for _, pw := range append(generated, supplied, "hash("+supplied+")") {
		if strings.Contains(logs.String(), pw) {
			t.Fatalf("log contains password %q: %s", pw, logs.String())
		}
	}
}

func TestAdminHashFailureIs500(t *testing.T) {
	acc := newFakeAccounts()
	a := &fakeAuth{authenticate: func(context.Context, string) (auth.Principal, error) {
		return auth.Principal{OwnerID: testOwner, Role: auth.RoleAdmin}, nil
	}}
	h := NewRouter(Deps{Auth: a, Accounts: acc, Hasher: failingHasher{}, Logger: slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))})
	wantError(t, do(h, http.MethodPost, "/v1/admin/accounts", `{"loginId":"abc","displayName":"x"}`, authHeader), http.StatusInternalServerError, "internal")
}

type failingHasher struct{}

func (failingHasher) Hash(context.Context, string) (string, error) { return "", errors.New("boom") }
