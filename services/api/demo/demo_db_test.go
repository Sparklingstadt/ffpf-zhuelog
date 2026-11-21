package demo

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/jst"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// TestResetWithTheFixture runs the real fixture through the real store, so a
// fixture the database refuses fails here rather than in the nightly cron.
func TestResetWithTheFixture(t *testing.T) {
	url := os.Getenv("API_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("API_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	s, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(s.Close)

	b := make([]byte, 6)
	_, _ = rand.Read(b)
	loginID := "demo-" + hex.EncodeToString(b)
	now := time.Now()
	id, err := s.ResetDemo(ctx, loginID, mustSeed(t, now), now)
	if err != nil {
		t.Fatalf("ResetDemo: %v", err)
	}
	owner := store.MemberOwnerID(id)
	t.Cleanup(func() {
		// An empty seed deletes everything the account owns; then the account.
		ctx := context.Background()
		_, _ = s.ResetDemo(ctx, loginID, store.DemoSeed{DisplayName: "x"}, now)
		if conn, err := pgx.Connect(ctx, url); err == nil {
			_, _ = conn.Exec(ctx, `DELETE FROM "PasswordAccount" WHERE "id" = $1`, id)
			_ = conn.Close(ctx)
		}
	})

	if notes := countRows(t, url, `SELECT count(*) FROM "LearningEntry" WHERE "ownerId" = $1 AND "deletedAt" IS NULL`, owner); notes != 12 {
		t.Fatalf("%d notes; want 12", notes)
	}
	if words := countRows(t, url, `SELECT count(*) FROM "VocabularyEntry" WHERE "ownerId" = $1`, owner); words != 10 {
		t.Fatalf("%d words; want 10", words)
	}
	if due := countRows(t, url, `SELECT count(*) FROM "ReviewItem" WHERE "ownerId" = $1 AND "due" <= $2`, owner, now); due == 0 {
		t.Fatalf("no reviews due; want some")
	}
	// Every item names a note or a word the seed made.
	if orphans := countRows(t, url, `SELECT count(*) FROM "ReviewItem" i WHERE i."ownerId" = $1
	 AND NOT EXISTS (SELECT 1 FROM "LearningEntry" e WHERE i."kind" = 'entry' AND e."id" = i."targetId" AND e."ownerId" = i."ownerId")
	 AND NOT EXISTS (SELECT 1 FROM "VocabularyEntry" v WHERE i."kind" = 'vocabulary' AND v."id" = i."targetId" AND v."ownerId" = i."ownerId")`,
		owner); orphans != 0 {
		t.Errorf("%d review items name nothing", orphans)
	}
	logDate := func(t time.Time) store.LogDate {
		t = t.In(jst.Location)
		return store.LogDate{Year: t.Year(), Month: int(t.Month()), Day: t.Day()}
	}
	days, err := s.StudyLog(ctx, owner, logDate(now.AddDate(0, 0, -8)), logDate(now))
	if err != nil || len(days) < 5 {
		t.Fatalf("study log = %+v, %v; want most of the last 7 days", days, err)
	}
}

// countRows runs a "SELECT count(*) ..." query and returns the count; the
// store no longer lists notes or words (the web owns them).
func countRows(t *testing.T, url, query string, args ...any) int {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	var n int
	if err := conn.QueryRow(ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func mustSeed(t *testing.T, now time.Time) store.DemoSeed {
	t.Helper()
	seed, err := Seed(now)
	if err != nil {
		t.Fatal(err)
	}
	return seed
}
