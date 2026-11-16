package auth

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

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
