package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

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
