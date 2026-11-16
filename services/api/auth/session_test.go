package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

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
