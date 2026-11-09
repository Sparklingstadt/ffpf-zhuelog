package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

func TestLoginDemoDisabled(t *testing.T) {
	f := newFixture()
	f.store.addDemoAccount("cdemo", "demo", 0)
	if f.svc.DemoEnabled() {
		t.Fatal("DemoEnabled with no DemoLoginID")
	}
	if _, err := f.svc.LoginDemo(context.Background(), testClient); !errors.Is(err, ErrDemoDisabled) {
		t.Fatalf("err = %v, want ErrDemoDisabled", err)
	}
	if len(f.store.consumed) != 0 || len(f.store.tokens) != 0 {
		t.Fatal("a disabled demo counted an attempt or signed in")
	}
}

func TestLoginDemoBeforeTheAccountExists(t *testing.T) {
	f := newFixture()
	f.svc.DemoLoginID = "demo"
	if _, err := f.svc.LoginDemo(context.Background(), testClient); !errors.Is(err, ErrDemoDisabled) {
		t.Fatalf("err = %v, want ErrDemoDisabled", err)
	}
}

func TestLoginDemoStartsAMemberSession(t *testing.T) {
	f := newFixture()
	f.svc.DemoLoginID = "demo"
	f.store.addDemoAccount("cdemo", "demo", 2)
	pair, err := f.svc.LoginDemo(context.Background(), testClient)
	if err != nil {
		t.Fatalf("LoginDemo: %v", err)
	}
	p := verifyAccess(t, f, pair.AccessToken)
	if p.OwnerID != store.MemberOwnerID("cdemo") || p.Role != RoleMember || p.SessionVersion != 2 {
		t.Fatalf("principal = %+v", p)
	}
	if f.hasher.count != 0 {
		t.Fatal("the demo login hashed a password")
	}
	if got := f.store.consumed; len(got) != 1 || got[0] != "demo:"+testClient {
		t.Fatalf("throttle keys = %q, want [demo:%s]", got, testClient)
	}
	if _, err := f.svc.Authenticate(context.Background(), pair.AccessToken); err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if _, err := f.svc.Refresh(context.Background(), pair.RefreshToken); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
}

func TestLoginDemoIsThrottledPerClient(t *testing.T) {
	f := newFixture()
	f.svc.DemoLoginID = "demo"
	f.store.addDemoAccount("cdemo", "demo", 0)
	ctx := context.Background()
	for i := range maxAttemptsPerClient {
		if _, err := f.svc.LoginDemo(ctx, testClient); err != nil {
			t.Fatalf("attempt %d: %v", i+1, err)
		}
	}
	if _, err := f.svc.LoginDemo(ctx, testClient); !errors.Is(err, ErrThrottled) {
		t.Fatalf("over the limit: err = %v, want ErrThrottled", err)
	}
	if _, err := f.svc.LoginDemo(ctx, "198.51.100.1"); err != nil {
		t.Fatalf("other client: %v", err)
	}
	f.clock.Advance(throttleWindow)
	if _, err := f.svc.LoginDemo(ctx, testClient); err != nil {
		t.Fatalf("after the window: %v", err)
	}
}

func TestIsDemo(t *testing.T) {
	f := newFixture()
	f.svc.DemoLoginID = "demo"
	f.store.addAccount("cdemo", "demo", "unused", 0)
	f.store.addAccount("calice", "alice", "pw", 0)
	ctx := context.Background()
	demo := store.MemberOwnerID("cdemo")

	cases := []struct {
		name string
		p    Principal
		want bool
	}{
		{"the demo account", Principal{OwnerID: demo, Role: RoleMember}, true},
		{"another member", Principal{OwnerID: store.MemberOwnerID("calice"), Role: RoleMember}, false},
		{"an admin acting as the demo", Principal{OwnerID: demo, Role: RoleAdmin, ActorID: "42"}, false},
		{"an admin", Principal{OwnerID: "42", Role: RoleAdmin}, false},
		{"a guest", Principal{OwnerID: GuestOwnerID, Role: RoleGuest}, false},
		{"an FFPF ID member", Principal{OwnerID: store.FfpfOwnerID("cdemo"), Role: RoleMember}, false},
		{"a deleted account", Principal{OwnerID: store.MemberOwnerID("cgone"), Role: RoleMember}, false},
	}
	for _, c := range cases {
		got, err := f.svc.IsDemo(ctx, c.p)
		if err != nil || got != c.want {
			t.Errorf("%s: IsDemo = %v, %v; want %v", c.name, got, err, c.want)
		}
	}

	// With the demo turned off, an account the reset made stays the demo
	// (its sessions may still be live); one that merely has the old loginId
	// does not.
	f.svc.DemoLoginID = ""
	if got, _ := f.svc.IsDemo(ctx, Principal{OwnerID: demo, Role: RoleMember}); got {
		t.Error("IsDemo is true for a password account with the demo turned off")
	}
	f.store.accounts["demo"].PasswordHash = store.DemoPasswordHash
	if got, _ := f.svc.IsDemo(ctx, Principal{OwnerID: demo, Role: RoleMember}); !got {
		t.Error("the reset's account is not the demo with the demo turned off")
	}

	f.svc.DemoLoginID = "demo"
	f.store.findAccountErr = errors.New("db down")
	if _, err := f.svc.IsDemo(ctx, Principal{OwnerID: demo, Role: RoleMember}); err == nil {
		t.Error("a store error was swallowed")
	}
}

func TestMeReportsTheDemo(t *testing.T) {
	f := newFixture()
	f.svc.DemoLoginID = "demo"
	f.store.addAccount("cdemo", "demo", "unused", 0)
	f.store.addAccount("calice", "alice", "pw", 0)
	ctx := context.Background()

	m, err := f.svc.Me(ctx, Principal{OwnerID: store.MemberOwnerID("cdemo"), Role: RoleMember})
	if err != nil || !m.Demo || m.Login != "demo" {
		t.Fatalf("Me(demo) = %+v, %v; want Demo", m, err)
	}
	m, err = f.svc.Me(ctx, Principal{OwnerID: store.MemberOwnerID("calice"), Role: RoleMember})
	if err != nil || m.Demo {
		t.Fatalf("Me(alice) = %+v, %v; want not Demo", m, err)
	}
}

// A real member whose loginId DEMO_LOGIN_ID happens to name is never entered
// without their password.
func TestLoginDemoRefusesARealMember(t *testing.T) {
	f := newFixture()
	f.svc.DemoLoginID = "demo"
	f.store.addAccount("creal", "demo", "scrypt$real-hash", 1)
	if _, err := f.svc.LoginDemo(context.Background(), testClient); !errors.Is(err, ErrDemoDisabled) {
		t.Fatalf("err = %v, want ErrDemoDisabled", err)
	}
}

// addDemoAccount adds an account as the nightly reset makes it: with the
// unusable password hash that marks the demo.
func (f *fakeStore) addDemoAccount(id, loginID string, sv int) *store.PasswordAccount {
	a := f.addAccount(id, loginID, "", sv)
	a.PasswordHash = store.DemoPasswordHash
	return a
}
