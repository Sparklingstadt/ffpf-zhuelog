package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

const passwordPath = "/v1/account/password"

var memberTok = map[string]string{"Authorization": "Bearer tok"}

// accountAuth authenticates "tok" as a member and answers ChangePassword with
// change.
func accountAuth(change func(ctx context.Context, p auth.Principal, current, next, confirm string) error) *fakeAuth {
	return &fakeAuth{
		authenticate: func(_ context.Context, tok string) (auth.Principal, error) {
			if tok != "tok" {
				return auth.Principal{}, auth.ErrUnauthorized
			}
			return auth.Principal{OwnerID: testOwner, Role: auth.RoleMember, SessionVersion: 2}, nil
		},
		changePass: change,
	}
}

func passwordBody(current, next, confirm string) string {
	return fmt.Sprintf(`{"currentPassword":%q,"newPassword":%q,"confirmPassword":%q}`, current, next, confirm)
}

func TestChangePasswordHandlerSuccess(t *testing.T) {
	var got struct {
		p                      auth.Principal
		current, next, confirm string
		calls                  int
	}
	a := accountAuth(func(_ context.Context, p auth.Principal, current, next, confirm string) error {
		got.p, got.current, got.next, got.confirm = p, current, next, confirm
		got.calls++
		return nil
	})
	h, _ := testRouter(t, a, fakePinger{}, nil)

	w := do(h, http.MethodPost, passwordPath, passwordBody(" old pw ", " new password ", " new password "), memberTok)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (body %q)", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("body = %q, want empty", w.Body.String())
	}
	if got.calls != 1 {
		t.Fatalf("ChangePassword called %d times, want 1", got.calls)
	}
	want := auth.Principal{OwnerID: testOwner, Role: auth.RoleMember, SessionVersion: 2}
	if got.p != want {
		t.Fatalf("principal = %+v, want %+v", got.p, want)
	}
	// Passwords are passed through untrimmed.
	if got.current != " old pw " || got.next != " new password " || got.confirm != " new password " {
		t.Fatalf("got (%q, %q, %q)", got.current, got.next, got.confirm)
	}
}

func TestChangePasswordHandlerErrors(t *testing.T) {
	cases := []struct {
		err          error
		status       int
		code, msg    string
		checkMessage bool
	}{
		{auth.ErrInvalidNewPassword, http.StatusBadRequest, "invalid_request", "パスワードは12〜128文字にしてください。", true},
		{auth.ErrPasswordMismatch, http.StatusBadRequest, "password_mismatch", "確認用のパスワードが一致しません。", true},
		{auth.ErrInvalidCurrentPassword, http.StatusBadRequest, "invalid_current_password", "現在のパスワードが違うか、一時的にロックされています。", true},
		{fmt.Errorf("wrapped: %w", auth.ErrInvalidCurrentPassword), http.StatusBadRequest, "invalid_current_password", "現在のパスワードが違うか、一時的にロックされています。", true},
		{auth.ErrForbidden, http.StatusForbidden, "forbidden", "この操作は会員だけが利用できます。", true},
		{fmt.Errorf("wrapped: %w", auth.ErrForbidden), http.StatusForbidden, "forbidden", "この操作は会員だけが利用できます。", true},
		{errors.New("db down"), http.StatusInternalServerError, "internal", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.err.Error(), func(t *testing.T) {
			a := accountAuth(func(context.Context, auth.Principal, string, string, string) error { return tc.err })
			h, _ := testRouter(t, a, fakePinger{}, nil)
			w := do(h, http.MethodPost, passwordPath, passwordBody("old", "new password!", "new password!"), memberTok)
			wantError(t, w, tc.status, tc.code)
			if tc.checkMessage {
				if got := decodeError(t, w).Error.Message; got != tc.msg {
					t.Fatalf("message = %q, want %q", got, tc.msg)
				}
			}
		})
	}
}

func TestChangePasswordHandlerRejectsBadRequests(t *testing.T) {
	a := accountAuth(nil) // ChangePassword must not be called
	h, _ := testRouter(t, a, fakePinger{}, nil)

	t.Run("no token", func(t *testing.T) {
		wantError(t, do(h, http.MethodPost, passwordPath, passwordBody("a", "b", "b"), nil), http.StatusUnauthorized, "unauthorized")
	})
	t.Run("?user=", func(t *testing.T) {
		wantError(t, do(h, http.MethodPost, passwordPath+"?user=password:abcdefghijklmnopqrstu", passwordBody("a", "b", "b"), memberTok), http.StatusBadRequest, "invalid_request")
	})
	for name, body := range map[string]string{
		"null field":    `{"currentPassword":null,"newPassword":"new password!","confirmPassword":"new password!"}`,
		"number field":  `{"currentPassword":"old","newPassword":123456789012,"confirmPassword":"new password!"}`,
		"unknown field": `{"currentPassword":"old","newPassword":"new password!","confirmPassword":"new password!","password":"x"}`,
		"null body":     `null`,
		"array body":    `[]`,
		"truncated":     `{"currentPassword":"old"`,
		"trailing data": passwordBody("old", "new password!", "new password!") + `{}`,
		"empty body":    ``,
	} {
		t.Run(name, func(t *testing.T) {
			wantError(t, do(h, http.MethodPost, passwordPath, body, memberTok), http.StatusBadRequest, "invalid_request")
		})
	}
	t.Run("wrong method", func(t *testing.T) {
		wantError(t, do(h, http.MethodGet, passwordPath, "", memberTok), http.StatusMethodNotAllowed, "method_not_allowed")
	})
}

func TestChangePasswordSharesAuthRateLimit(t *testing.T) {
	invalid := func(context.Context, auth.Principal, string, string, string) error {
		return auth.ErrInvalidCurrentPassword
	}

	t.Run("after /v1/auth/*", func(t *testing.T) {
		a := accountAuth(invalid)
		a.password = func(context.Context, string, string) (auth.TokenPair, error) {
			return auth.TokenPair{}, auth.ErrUnauthorized
		}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		for i := range 10 {
			if w := do(h, http.MethodPost, "/v1/auth/password", `{"loginId":"someone","password":"pw"}`, nil); w.Code != http.StatusUnauthorized {
				t.Fatalf("login %d: status = %d, want 401", i+1, w.Code)
			}
		}
		wantError(t, do(h, http.MethodPost, passwordPath, passwordBody("old", "new password!", "new password!"), memberTok), http.StatusTooManyRequests, "rate_limited")
	})

	t.Run("before /v1/auth/*", func(t *testing.T) {
		a := accountAuth(invalid)
		h, _ := testRouter(t, a, fakePinger{}, nil)
		for i := range 10 {
			w := do(h, http.MethodPost, passwordPath, passwordBody("old", "new password!", "new password!"), memberTok)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("request %d: status = %d, want 400", i+1, w.Code)
			}
		}
		wantError(t, do(h, http.MethodPost, passwordPath, passwordBody("old", "new password!", "new password!"), memberTok), http.StatusTooManyRequests, "rate_limited")
		wantError(t, do(h, http.MethodPost, "/v1/auth/logout", `{"refreshToken":"x"}`, nil), http.StatusTooManyRequests, "rate_limited")
		// Another client is unaffected.
		w := do(h, http.MethodPost, passwordPath, passwordBody("old", "new password!", "new password!"),
			map[string]string{"Authorization": "Bearer tok", "X-Forwarded-For": "203.0.113.50"})
		wantError(t, w, http.StatusBadRequest, "invalid_current_password")
	})

	t.Run("unauthenticated requests count too", func(t *testing.T) {
		a := accountAuth(invalid)
		h, _ := testRouter(t, a, fakePinger{}, nil)
		for range 10 {
			wantError(t, do(h, http.MethodPost, passwordPath, passwordBody("a", "b", "b"), map[string]string{"Authorization": "Bearer bad"}), http.StatusUnauthorized, "unauthorized")
		}
		wantError(t, do(h, http.MethodPost, passwordPath, passwordBody("a", "b", "b"), memberTok), http.StatusTooManyRequests, "rate_limited")
	})
}

func TestChangePasswordLogsOmitPasswords(t *testing.T) {
	secrets := []string{"cur-SECRET", "new-SECRET-password", "confirm-SECRET-pw"}
	outcomes := []error{nil, auth.ErrInvalidCurrentPassword, auth.ErrPasswordMismatch, errors.New("db down")}
	for _, outcome := range outcomes {
		a := accountAuth(func(context.Context, auth.Principal, string, string, string) error { return outcome })
		h, buf := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, passwordPath, passwordBody(secrets[0], secrets[1], secrets[2]), memberTok)
		do(h, http.MethodPost, passwordPath, `{"currentPassword":"cur-SECRET","newPassword":null}`, memberTok)
		if buf.Len() == 0 {
			t.Fatal("nothing was logged")
		}
		for _, s := range secrets {
			if strings.Contains(buf.String(), s) {
				t.Errorf("log contains %q:\n%s", s, buf.String())
			}
			if strings.Contains(w.Body.String(), s) {
				t.Errorf("response echoes %q: %s", s, w.Body.String())
			}
		}
	}
}
