package linebot

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
)

const specAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func hashOf(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

func TestIssueCode(t *testing.T) {
	e := newEnv(t)
	code, expires, err := e.svc.IssueCode(context.Background(), auth.Principal{OwnerID: testOwner, Role: auth.RoleMember})
	if err != nil {
		t.Fatal(err)
	}
	if len([]rune(code)) != 8 {
		t.Fatalf("code = %q, want 8 chars", code)
	}
	for _, r := range code {
		if !strings.ContainsRune(specAlphabet, r) {
			t.Fatalf("code %q has %q outside the alphabet", code, r)
		}
	}
	if !expires.Equal(t0.Add(10 * time.Minute)) {
		t.Errorf("expiresAt = %v, want now+10m", expires)
	}
	if len(e.store.codes) != 1 {
		t.Fatalf("stored codes = %v", e.store.codes)
	}
	stored, ok := e.store.codes[hashOf(code)]
	if !ok {
		t.Fatalf("store does not hold the SHA-256 hex of the code: %v", e.store.codes)
	}
	if stored.ownerID != testOwner || stored.role != auth.RoleMember || !stored.expiresAt.Equal(expires) {
		t.Errorf("stored = %+v", stored)
	}
	for h := range e.store.codes {
		if h == code {
			t.Error("plaintext code stored")
		}
	}
}

func TestIssueCodeAdmin(t *testing.T) {
	e := newEnv(t)
	if _, _, err := e.svc.IssueCode(context.Background(), auth.Principal{OwnerID: "12345", Role: auth.RoleAdmin}); err != nil {
		t.Fatal(err)
	}
}

func TestIssueCodeUsesRandomSource(t *testing.T) {
	e := newEnv(t)
	// Every byte maps to alphabet[b%32]; 0x00 -> 'A', 0x1f -> '9'.
	e.svc.Random = strings.NewReader("\x00\x01\x1f\x20\x21\x3f\xff\x07")
	code, _, err := e.svc.IssueCode(context.Background(), auth.Principal{OwnerID: testOwner, Role: auth.RoleMember})
	if err != nil {
		t.Fatal(err)
	}
	want := string([]byte{
		specAlphabet[0], specAlphabet[1], specAlphabet[31], specAlphabet[0],
		specAlphabet[1], specAlphabet[31], specAlphabet[31], specAlphabet[7],
	})
	if code != want {
		t.Errorf("code = %q, want %q", code, want)
	}
}

func TestIssueCodeRandomFailure(t *testing.T) {
	e := newEnv(t)
	e.svc.Random = strings.NewReader("abc")
	if _, _, err := e.svc.IssueCode(context.Background(), auth.Principal{OwnerID: testOwner, Role: auth.RoleMember}); err == nil {
		t.Fatal("want an error when the random source runs dry")
	}
	if len(e.store.codes) != 0 {
		t.Error("nothing should be stored")
	}
}

func TestIssueCodeGuestForbidden(t *testing.T) {
	e := newEnv(t)
	_, _, err := e.svc.IssueCode(context.Background(), auth.Principal{OwnerID: auth.GuestOwnerID, Role: auth.RoleGuest})
	if !errors.Is(err, auth.ErrForbidden) {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
	if len(e.store.calls) != 0 {
		t.Errorf("store called: %v", e.store.calls)
	}
}

func TestLinkedAndUnlink(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if ok, err := e.svc.Linked(ctx, testOwner); err != nil || ok {
		t.Fatalf("Linked = %v, %v; want false", ok, err)
	}
	e.link()
	if ok, err := e.svc.Linked(ctx, testOwner); err != nil || !ok {
		t.Fatalf("Linked = %v, %v; want true", ok, err)
	}
	if err := e.svc.Unlink(ctx, testOwner); err != nil {
		t.Fatal(err)
	}
	if len(e.store.links) != 0 {
		t.Errorf("links = %v", e.store.links)
	}
}

func TestNormalizeCode(t *testing.T) {
	tests := []struct {
		in   string
		want string
		ok   bool
	}{
		{"ABCD2345", "ABCD2345", true},
		{" abcd2345 ", "ABCD2345", true},
		{"ＡＢＣＤ２３４５", "ABCD2345", true},
		{"　ａｂｃｄ２３４５　", "ABCD2345", true},
		{"ABCD234", "ABCD234", false},     // 7
		{"ABCD23456", "ABCD23456", false}, // 9
		{"ABCD2340", "ABCD2340", false},   // 0 not in the alphabet
		{"ABCD2341", "ABCD2341", false},   // 1
		{"ABCDO345", "ABCDO345", false},   // O
		{"ABCDI345", "ABCDI345", false},   // I
		{"ABCD 345", "ABCD 345", false},
		{"你好你好你好你好", "你好你好你好你好", false},
		{"", "", false},
	}
	for _, tt := range tests {
		got, ok := codeShape(tt.in)
		if got != tt.want || ok != tt.ok {
			t.Errorf("codeShape(%q) = %q, %v; want %q, %v", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}

func (e *env) putCode(owner, role, code string, expires time.Time) {
	e.store.codes[hashOf(code)] = storedCode{owner, role, expires}
}

func TestLinkWithNormalizedCodes(t *testing.T) {
	for _, in := range []string{" abcd2345 ", "ＡＢＣＤ２３４５", "ABCD2345"} {
		e := newEnv(t)
		e.putCode(testOwner, "member", "ABCD2345", t0.Add(5*time.Minute))
		if err := e.svc.HandleEvent(context.Background(), textEvent("e1", in), e.deadline()); err != nil {
			t.Fatal(err)
		}
		if got := e.onlyReply(t); got != line.MsgLinked {
			t.Errorf("%q: reply = %q, want MsgLinked", in, got)
		}
		if e.msg.tokens[0] != "tok-e1" {
			t.Errorf("reply token = %q", e.msg.tokens[0])
		}
		l, ok := e.store.links[testLineUser]
		if !ok || l.OwnerID != testOwner {
			t.Errorf("%q: link = %+v", in, l)
		}
		if len(e.gen.calls) != 0 || e.store.called("InsertLineMessage") {
			t.Errorf("%q: a link code must not be processed as a message", in)
		}
		if !e.store.called("ResetThrottle") || e.store.throttle["line-link:"+testLineUser] != 0 {
			t.Errorf("%q: throttle not reset on success", in)
		}
	}
}

func TestLinkExpiredCode(t *testing.T) {
	e := newEnv(t)
	e.putCode(testOwner, "member", "ABCD2345", t0.Add(-time.Second))
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "ABCD2345"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if got := e.onlyReply(t); got != line.MsgBadCode {
		t.Errorf("reply = %q, want MsgBadCode", got)
	}
	if n := e.store.throttle["line-link:"+testLineUser]; n != 1 {
		t.Errorf("throttle count = %d, want 1", n)
	}
	if len(e.store.links) != 0 {
		t.Error("expired code must not link")
	}
}

func TestLinkThrottledOnSixthAttempt(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if err := e.svc.HandleEvent(ctx, textEvent("e"+string(rune('a'+i)), "ZZZZ2345"), e.deadline()); err != nil {
			t.Fatal(err)
		}
	}
	if e.store.redeemCnt != 5 {
		t.Fatalf("redeem calls = %d, want 5", e.store.redeemCnt)
	}
	// Even a valid code is refused once throttled, without a store lookup.
	e.putCode(testOwner, "member", "ABCD2345", t0.Add(5*time.Minute))
	e.msg.replies = nil
	if err := e.svc.HandleEvent(ctx, textEvent("e6", "ABCD2345"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if got := e.onlyReply(t); got != line.MsgThrottled {
		t.Errorf("reply = %q, want MsgThrottled", got)
	}
	if e.store.redeemCnt != 5 {
		t.Errorf("redeem calls = %d, want still 5", e.store.redeemCnt)
	}
	if len(e.store.links) != 0 {
		t.Error("throttled attempt must not link")
	}
}

func TestLinkThrottleWindowAndLimit(t *testing.T) {
	// Pin the key, limit and window passed to ConsumeThrottle.
	e := newEnv(t)
	rec := &throttleRecorder{fakeStore: e.store}
	e.svc.Store = rec
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "ZZZZ2345"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if rec.key != "line-link:"+testLineUser || rec.limit != 5 || rec.window != time.Hour {
		t.Errorf("throttle = %q %d %v", rec.key, rec.limit, rec.window)
	}
}

type throttleRecorder struct {
	*fakeStore
	key    string
	limit  int
	window time.Duration
}

func (r *throttleRecorder) ConsumeThrottle(ctx context.Context, key string, limit int, window time.Duration, now time.Time) (bool, error) {
	r.key, r.limit, r.window = key, limit, window
	return r.fakeStore.ConsumeThrottle(ctx, key, limit, window, now)
}

func TestRelink(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.putCode("owner-2", "member", "ABCD2345", t0.Add(5*time.Minute))
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "abcd2345"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if got := e.onlyReply(t); got != line.MsgRelinked {
		t.Errorf("reply = %q, want MsgRelinked", got)
	}
	if l := e.store.links[testLineUser]; l.OwnerID != "owner-2" {
		t.Errorf("link = %+v", l)
	}
	if len(e.gen.calls) != 0 {
		t.Error("generator called")
	}
}

func TestCodeShapedMessageSkipsOtherChecks(t *testing.T) {
	// Redemption comes before the owner check: a linked user with an invalid
	// owner can still switch accounts.
	e := newEnv(t)
	e.link()
	e.valid = false
	e.putCode("owner-2", "member", "ABCD2345", t0.Add(5*time.Minute))
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "ABCD2345"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if got := e.onlyReply(t); got != line.MsgRelinked {
		t.Errorf("reply = %q, want MsgRelinked", got)
	}
}

func TestStoreErrorOnFindLink(t *testing.T) {
	e := newEnv(t)
	e.store.findErr = errBoom
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline()); !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want errBoom", err)
	}
	if len(e.msg.replies) != 0 {
		t.Errorf("replies = %v", e.msg.replies)
	}
}
