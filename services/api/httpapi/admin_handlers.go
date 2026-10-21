package httpapi

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	msgInvalidLoginID  = "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。"
	msgInvalidName     = "表示名は1〜50文字にしてください。"
	msgLoginIDTaken    = "このログインIDはすでに使われています。"
	msgAccountNotFound = "アカウントが見つかりません。"

	maxDisplayNameRunes = 50
	minPasswordRunes    = 12
	maxPasswordRunes    = 128
)

var loginIDPattern = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

// webTrim trims what JavaScript's String.prototype.trim trims, so blank
// input is judged exactly as the web app judges it.
func webTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0xFEFF, 0x2028, 0x2029:
			return true
		}
		return unicode.Is(unicode.Zs, r)
	})
}

// accountInput is the validated form of an admin request. Password is what
// will be stored: the one given, or a generated one.
type accountInput struct {
	LoginID, DisplayName, Password string
	Generated                      bool
}

// resolvePassword applies the web app's optionalPasswordSchema: blank means
// generate, anything else must be 12-128 characters (not trimmed).
func resolvePassword(given string) (password string, generated bool, ok bool) {
	if webTrim(given) == "" {
		return auth.GeneratePassword(), true, true
	}
	if n := utf8.RuneCountInString(given); n < minPasswordRunes || n > maxPasswordRunes {
		return "", false, false
	}
	return given, false, true
}

// validateAccountInput checks loginId, displayName and password in that
// order and returns the message of the first failing field.
func validateAccountInput(loginID, displayName, password string) (accountInput, string) {
	var in accountInput
	in.LoginID = strings.ToLower(webTrim(loginID))
	if !loginIDPattern.MatchString(in.LoginID) {
		return in, msgInvalidLoginID
	}
	in.DisplayName = webTrim(displayName)
	if n := utf8.RuneCountInString(in.DisplayName); n < 1 || n > maxDisplayNameRunes || strings.ContainsRune(in.DisplayName, 0) {
		return in, msgInvalidName
	}
	pw, generated, ok := resolvePassword(password)
	if !ok {
		return in, msgInvalidNewPassword
	}
	in.Password, in.Generated = pw, generated
	return in, ""
}

// requireAdmin answers 403 unless the caller is an admin.
func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if principalFrom(r.Context()).Role != auth.RoleAdmin {
			writeError(w, http.StatusForbidden, "forbidden", msgForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type accountJSON struct {
	ID          string `json:"id"`
	OwnerID     string `json:"ownerId"`
	LoginID     string `json:"loginId"`
	DisplayName string `json:"displayName"`
	CreatedAt   string `json:"createdAt"`
	Locked      bool   `json:"locked"`
}

func toAccountJSON(a store.AccountSummary) accountJSON {
	return accountJSON{
		ID: a.ID, OwnerID: "password:" + a.ID, LoginID: a.LoginID,
		DisplayName: a.DisplayName, CreatedAt: formatTime(a.CreatedAt), Locked: a.Locked,
	}
}

func listAccounts(acc Accounts, now func() time.Time) http.Handler {
	type response struct {
		Accounts []accountJSON `json:"accounts"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		list, err := acc.ListPasswordAccounts(r.Context(), now())
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		resp := response{Accounts: make([]accountJSON, len(list))}
		for i, a := range list {
			resp.Accounts[i] = toAccountJSON(a)
		}
		writeJSON(w, http.StatusOK, resp)
	})
}

func createAccount(acc Accounts, h PasswordHasher, now func() time.Time) http.Handler {
	type request struct {
		LoginID     jsonString `json:"loginId"`
		DisplayName jsonString `json:"displayName"`
		Password    jsonString `json:"password"`
	}
	type response struct {
		Account   accountJSON `json:"account"`
		Password  string      `json:"password"`
		Generated bool        `json:"generated"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		in, msg := validateAccountInput(string(req.LoginID), string(req.DisplayName), string(req.Password))
		if msg != "" {
			writeError(w, http.StatusBadRequest, "invalid_request", msg)
			return
		}
		hash, err := h.Hash(r.Context(), in.Password)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		a, err := acc.CreatePasswordAccount(r.Context(), in.LoginID, in.DisplayName, hash, now())
		if errors.Is(err, store.ErrLoginIDTaken) {
			writeError(w, http.StatusConflict, "login_id_taken", msgLoginIDTaken)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, response{Account: toAccountJSON(a), Password: in.Password, Generated: in.Generated})
	})
}

func resetAccountPassword(acc Accounts, h PasswordHasher, now func() time.Time) http.Handler {
	type request struct {
		Password jsonString `json:"password"`
	}
	type response struct {
		LoginID   string `json:"loginId"`
		Password  string `json:"password"`
		Generated bool   `json:"generated"`
	}
	notFound := func(w http.ResponseWriter) {
		writeError(w, http.StatusNotFound, "not_found", msgAccountNotFound)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		pw, generated, ok := resolvePassword(string(req.Password))
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_request", msgInvalidNewPassword)
			return
		}
		id := r.PathValue("id")
		if !validID(id) {
			notFound(w)
			return
		}
		a, err := acc.FindPasswordAccountByID(r.Context(), id)
		if errors.Is(err, store.ErrNotFound) {
			notFound(w)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		hash, err := h.Hash(r.Context(), pw)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		if err := acc.SetPassword(r.Context(), id, hash, now()); errors.Is(err, store.ErrNotFound) {
			notFound(w)
			return
		} else if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, response{LoginID: a.LoginID, Password: pw, Generated: generated})
	})
}

// PasswordHasher hashes a password in the web app's scrypt format.
type PasswordHasher interface {
	Hash(ctx context.Context, password string) (string, error)
}
