package auth

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func nodeHash(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("testdata/node_scrypt_hash.txt")
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(b))
}

func TestVerifyNodeHash(t *testing.T) {
	var v PasswordVerifier
	hash := nodeHash(t)
	ctx := context.Background()
	if ok, err := v.Verify(ctx, "correct horse battery", hash); !ok || err != nil {
		t.Fatalf("correct password: ok=%v err=%v, want true, nil", ok, err)
	}
	if ok, err := v.Verify(ctx, "wrong", hash); ok || err != nil {
		t.Fatalf("wrong password: ok=%v err=%v, want false, nil", ok, err)
	}
}

func TestVerifyRejectsBadHashes(t *testing.T) {
	var v PasswordVerifier
	parts := strings.Split(nodeHash(t), ":")
	if len(parts) != 6 {
		t.Fatalf("fixture has %d parts", len(parts))
	}
	build := func(mut func(p []string)) string {
		p := append([]string(nil), parts...)
		mut(p)
		return strings.Join(p, ":")
	}

	cases := map[string]string{
		"too few parts":     strings.Join(parts[:5], ":"),
		"too many parts":    nodeHash(t) + ":x",
		"bcrypt prefix":     build(func(p []string) { p[0] = "bcrypt" }),
		"N=65536":           build(func(p []string) { p[1] = "65536" }),
		"N=3":               build(func(p []string) { p[1] = "3" }),
		"N=1":               build(func(p []string) { p[1] = "1" }),
		"N=0":               build(func(p []string) { p[1] = "0" }),
		"N non-digit":       build(func(p []string) { p[1] = "3x" }),
		"N 10 digits":       build(func(p []string) { p[1] = "1000000000" }),
		"r=9":               build(func(p []string) { p[2] = "9" }),
		"r=0":               build(func(p []string) { p[2] = "0" }),
		"p=5":               build(func(p []string) { p[3] = "5" }),
		"p=0":               build(func(p []string) { p[3] = "0" }),
		"p signed":          build(func(p []string) { p[3] = "+1" }),
		"key 32 bytes":      build(func(p []string) { p[5] = p[5][:43] }),
		"key trailing =":    build(func(p []string) { p[5] += "=" }),
		"key non-canonical": build(func(p []string) { p[5] = p[5][:len(p[5])-1] + "B" }),
		"salt empty":        build(func(p []string) { p[4] = "" }),
		"salt trailing =":   build(func(p []string) { p[4] += "=" }),
		"salt invalid char": build(func(p []string) { p[4] = "!!!!" }),
		"empty hash":        "",
	}
	for name, hash := range cases {
		t.Run(name, func(t *testing.T) {
			if ok, err := v.Verify(context.Background(), "correct horse battery", hash); ok || err != nil {
				t.Fatalf("ok=%v err=%v, want false, nil", ok, err)
			}
		})
	}
}

func TestVerifyTamperedKeyIsFalse(t *testing.T) {
	var v PasswordVerifier
	parts := strings.Split(nodeHash(t), ":")
	// Flip a canonical key into a different canonical key: scrypt succeeds, compare fails.
	k := []byte(parts[5])
	if k[0] == 'A' {
		k[0] = 'B'
	} else {
		k[0] = 'A'
	}
	parts[5] = string(k)
	if ok, err := v.Verify(context.Background(), "correct horse battery", strings.Join(parts, ":")); ok || err != nil {
		t.Fatalf("tampered key: ok=%v err=%v, want false, nil", ok, err)
	}
}

func TestSimulateDoesNotPanic(t *testing.T) {
	var v PasswordVerifier
	for range 2 {
		if err := v.Simulate(context.Background(), "x"); err != nil {
			t.Fatalf("Simulate: %v", err)
		}
	}
}

// countingKey replaces scrypt in a PasswordVerifier. It records how many
// derivations run at once and blocks each one until release is closed.
type countingKey struct {
	running, max, total atomic.Int32
	release             chan struct{}
}

func newCountingKey() *countingKey { return &countingKey{release: make(chan struct{})} }

func (c *countingKey) derive(_, _ []byte, _, _, _, keyLen int) ([]byte, error) {
	n := c.running.Add(1)
	for {
		m := c.max.Load()
		if n <= m || c.max.CompareAndSwap(m, n) {
			break
		}
	}
	c.total.Add(1)
	<-c.release
	c.running.Add(-1)
	return make([]byte, keyLen), nil
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestConcurrentHashesAreBounded(t *testing.T) {
	ck := newCountingKey()
	v := &PasswordVerifier{deriveKey: ck.derive}
	close(ck.release) // let Warm's derivation finish
	v.Warm()
	ck.release = make(chan struct{})
	ck.total.Store(0)
	ck.max.Store(0)
	hash := nodeHash(t)

	const callers = 12
	var wg sync.WaitGroup
	errs := make(chan error, callers)
	for i := range callers {
		wg.Go(func() {
			// Verify and Simulate share the bound.
			if i%2 == 0 {
				_, err := v.Verify(context.Background(), "pw", hash)
				errs <- err
				return
			}
			errs <- v.Simulate(context.Background(), "pw")
		})
	}

	waitFor(t, "4 running derivations", func() bool { return ck.running.Load() == maxConcurrentHashes })
	time.Sleep(50 * time.Millisecond) // give any excess caller time to get in
	if got := ck.running.Load(); got != maxConcurrentHashes {
		t.Fatalf("running = %d, want %d", got, maxConcurrentHashes)
	}
	close(ck.release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("hash: %v", err)
		}
	}
	if got := ck.max.Load(); got != maxConcurrentHashes {
		t.Fatalf("max concurrent derivations = %d, want %d", got, maxConcurrentHashes)
	}
	if got := ck.total.Load(); got != callers {
		t.Fatalf("derivations = %d, want %d (one per call)", got, callers)
	}
}

func TestHashWaitRespectsContext(t *testing.T) {
	ck := newCountingKey()
	v := &PasswordVerifier{deriveKey: ck.derive}
	close(ck.release)
	v.Warm()
	ck.release = make(chan struct{})
	hash := nodeHash(t)

	// Occupy every slot.
	var wg sync.WaitGroup
	for range maxConcurrentHashes {
		wg.Go(func() { _, _ = v.Verify(context.Background(), "pw", hash) })
	}
	waitFor(t, "all slots taken", func() bool { return ck.running.Load() == maxConcurrentHashes })
	defer func() { close(ck.release); wg.Wait() }()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if ok, err := v.Verify(ctx, "pw", hash); ok || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Verify: ok=%v err=%v, want false, DeadlineExceeded", ok, err)
	}
	if err := v.Simulate(ctx, "pw"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Simulate: err=%v, want DeadlineExceeded", err)
	}

	cancelled, cancelNow := context.WithCancel(context.Background())
	cancelNow()
	if _, err := v.Verify(cancelled, "pw", hash); !errors.Is(err, context.Canceled) {
		t.Fatalf("Verify with cancelled ctx: err=%v, want Canceled", err)
	}
}

func TestWarmBuildsDummyHashOnce(t *testing.T) {
	ck := newCountingKey()
	close(ck.release)
	v := &PasswordVerifier{deriveKey: ck.derive}
	v.Warm()
	v.Warm()
	if got := ck.total.Load(); got != 1 {
		t.Fatalf("Warm derivations = %d, want 1", got)
	}
	// After Warm, each Simulate costs exactly one derivation.
	for i := range 2 {
		if err := v.Simulate(context.Background(), "pw"); err != nil {
			t.Fatalf("Simulate: %v", err)
		}
		if got, want := ck.total.Load(), int32(2+i); got != want {
			t.Fatalf("derivations after %d Simulate = %d, want %d", i+1, got, want)
		}
	}
}

func TestHashVerifiesAndMatchesFormat(t *testing.T) {
	var v PasswordVerifier
	ctx := context.Background()
	const pw = "新しい correct horse"
	hash, err := v.Hash(ctx, pw)
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}
	if !strings.HasPrefix(hash, "scrypt:32768:8:1:") {
		t.Fatalf("hash %q does not start with scrypt:32768:8:1:", hash)
	}
	h, ok := parseScryptHash(hash)
	if !ok {
		t.Fatalf("hash %q is rejected by the web's parse rules", hash)
	}
	if len(h.salt) != 16 || len(h.key) != 64 {
		t.Fatalf("salt %d bytes, key %d bytes; want 16 and 64", len(h.salt), len(h.key))
	}
	if ok, err := v.Verify(ctx, pw, hash); !ok || err != nil {
		t.Fatalf("Verify(correct) = %v, %v; want true, nil", ok, err)
	}
	if ok, err := v.Verify(ctx, pw+"x", hash); ok || err != nil {
		t.Fatalf("Verify(wrong) = %v, %v; want false, nil", ok, err)
	}
	again, err := v.Hash(ctx, pw)
	if err != nil {
		t.Fatalf("second Hash: %v", err)
	}
	if again == hash {
		t.Fatal("two hashes of the same password are equal; the salt is not random")
	}
}

func TestHashSharesTheBoundAndRespectsContext(t *testing.T) {
	ck := newCountingKey()
	v := &PasswordVerifier{deriveKey: ck.derive}
	hash := nodeHash(t)

	var wg sync.WaitGroup
	for range maxConcurrentHashes {
		wg.Go(func() { _, _ = v.Verify(context.Background(), "pw", hash) })
	}
	waitFor(t, "all slots taken", func() bool { return ck.running.Load() == maxConcurrentHashes })
	defer func() { close(ck.release); wg.Wait() }()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if got, err := v.Hash(ctx, "pw"); got != "" || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Hash = %q, %v; want \"\", DeadlineExceeded", got, err)
	}
	if got := ck.total.Load(); got != maxConcurrentHashes {
		t.Fatalf("derivations = %d, want %d (Hash must wait for a slot)", got, maxConcurrentHashes)
	}
}

func TestHashScryptFailure(t *testing.T) {
	v := &PasswordVerifier{deriveKey: func(_, _ []byte, _, _, _, _ int) ([]byte, error) {
		return nil, errors.New("boom")
	}}
	if got, err := v.Hash(context.Background(), "pw"); got != "" || err == nil {
		t.Fatalf("Hash = %q, %v; want an error", got, err)
	}
}
