package store

import (
	"context"
	"sync"
	"testing"
	"time"
)

// throttleKeys returns a unique key prefix and removes its rows when the test
// ends.
func throttleKeys(t *testing.T, s *Store) string {
	t.Helper()
	prefix := "test:" + newID() + ":"
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "SignInThrottle" WHERE "key" LIKE $1 || '%'`, prefix)
	})
	return prefix
}

func throttleRow(t *testing.T, s *Store, key string) (int, time.Time, bool) {
	t.Helper()
	var count int
	var expires time.Time
	err := s.pool.QueryRow(context.Background(),
		`SELECT "count", "expiresAt" FROM "SignInThrottle" WHERE "key" = $1`, key).Scan(&count, &expires)
	if err != nil {
		return 0, time.Time{}, false
	}
	return count, expires, true
}

func TestConsumeThrottleCountsUpToLimit(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	key := throttleKeys(t, s) + "a"
	now := fixedNow()

	for i := 1; i <= 3; i++ {
		ok, err := s.ConsumeThrottle(ctx, key, 3, 15*time.Minute, now.Add(time.Duration(i)*time.Minute))
		if err != nil || !ok {
			t.Fatalf("attempt %d: ok=%v err=%v, want true", i, ok, err)
		}
	}
	count, expires, found := throttleRow(t, s, key)
	if !found || count != 3 {
		t.Fatalf("row = %d (found %v), want count 3", count, found)
	}
	// The window starts at the first attempt and is not extended.
	if want := now.Add(time.Minute + 15*time.Minute); !expires.Equal(want) {
		t.Fatalf("expiresAt = %v, want %v", expires, want)
	}

	for i := 4; i <= 5; i++ {
		ok, err := s.ConsumeThrottle(ctx, key, 3, 15*time.Minute, now.Add(5*time.Minute))
		if err != nil || ok {
			t.Fatalf("attempt %d: ok=%v err=%v, want false", i, ok, err)
		}
	}
	if count, _, _ := throttleRow(t, s, key); count != 5 {
		t.Fatalf("count = %d, want 5 (over-limit attempts still count)", count)
	}
}

func TestConsumeThrottleKeysAreIndependent(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	prefix := throttleKeys(t, s)
	now := fixedNow()

	if ok, err := s.ConsumeThrottle(ctx, prefix+"a", 1, time.Minute, now); err != nil || !ok {
		t.Fatalf("a first: ok=%v err=%v", ok, err)
	}
	if ok, err := s.ConsumeThrottle(ctx, prefix+"a", 1, time.Minute, now); err != nil || ok {
		t.Fatalf("a second: ok=%v err=%v, want false", ok, err)
	}
	if ok, err := s.ConsumeThrottle(ctx, prefix+"b", 1, time.Minute, now); err != nil || !ok {
		t.Fatalf("b first: ok=%v err=%v, want true", ok, err)
	}
}

func TestConsumeThrottleRestartsAfterWindow(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	key := throttleKeys(t, s) + "a"
	now := fixedNow()

	for range 3 {
		if _, err := s.ConsumeThrottle(ctx, key, 2, 15*time.Minute, now); err != nil {
			t.Fatal(err)
		}
	}
	// expiresAt == now counts as ended, like the web.
	later := now.Add(15 * time.Minute)
	ok, err := s.ConsumeThrottle(ctx, key, 2, 15*time.Minute, later)
	if err != nil || !ok {
		t.Fatalf("after window: ok=%v err=%v, want true", ok, err)
	}
	count, expires, _ := throttleRow(t, s, key)
	if count != 1 || !expires.Equal(later.Add(15*time.Minute)) {
		t.Fatalf("row = %d, %v; want 1, %v", count, expires, later.Add(15*time.Minute))
	}
}

func TestResetThrottle(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	prefix := throttleKeys(t, s)
	now := fixedNow()

	for _, k := range []string{"a", "b"} {
		for range 2 {
			if _, err := s.ConsumeThrottle(ctx, prefix+k, 2, time.Minute, now); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := s.ResetThrottle(ctx, prefix+"a"); err != nil {
		t.Fatalf("ResetThrottle: %v", err)
	}
	if _, _, found := throttleRow(t, s, prefix+"a"); found {
		t.Fatal("reset key still has a row")
	}
	if count, _, _ := throttleRow(t, s, prefix+"b"); count != 2 {
		t.Fatalf("other key count = %d, want 2", count)
	}
	if err := s.ResetThrottle(ctx, prefix+"missing"); err != nil {
		t.Fatalf("ResetThrottle of a missing key: %v", err)
	}
	if ok, err := s.ConsumeThrottle(ctx, prefix+"a", 2, time.Minute, now); err != nil || !ok {
		t.Fatalf("after reset: ok=%v err=%v", ok, err)
	}
}

func TestConsumeThrottlePrunesExpiredRows(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	prefix := throttleKeys(t, s)
	now := fixedNow()

	_, err := s.pool.Exec(ctx,
		`INSERT INTO "SignInThrottle" ("key", "count", "expiresAt") VALUES ($1, 9, $3), ($2, 9, $4)`,
		prefix+"dead", prefix+"live", now.Add(-time.Second), now.Add(time.Second))
	if err != nil {
		t.Fatalf("seed rows: %v", err)
	}
	if _, err := s.ConsumeThrottle(ctx, prefix+"other", 5, time.Minute, now); err != nil {
		t.Fatalf("ConsumeThrottle: %v", err)
	}
	if _, _, found := throttleRow(t, s, prefix+"dead"); found {
		t.Error("expired row was not pruned")
	}
	if count, _, found := throttleRow(t, s, prefix+"live"); !found || count != 9 {
		t.Errorf("live row = %d (found %v), want untouched", count, found)
	}
}

func TestConsumeThrottleConcurrent(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	key := throttleKeys(t, s) + "a"
	now := fixedNow()

	const attempts, limit = 12, 5
	var wg sync.WaitGroup
	var mu sync.Mutex
	allowed := 0
	for range attempts {
		wg.Go(func() {
			ok, err := s.ConsumeThrottle(ctx, key, limit, time.Minute, now)
			if err != nil {
				t.Errorf("ConsumeThrottle: %v", err)
				return
			}
			if ok {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if allowed != limit {
		t.Fatalf("allowed = %d, want exactly %d", allowed, limit)
	}
	if count, _, _ := throttleRow(t, s, key); count != attempts {
		t.Fatalf("count = %d, want %d", count, attempts)
	}
}
