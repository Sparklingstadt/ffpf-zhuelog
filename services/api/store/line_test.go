package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// newLineUser returns a fresh LINE user ID.
func newLineUser() string { return "U" + newID() }

// cleanLine removes the LINE rows of owner and of the given LINE users when
// the test ends.
func cleanLine(t *testing.T, s *Store, owners []string, lineUsers ...string) {
	t.Helper()
	t.Cleanup(func() {
		ctx := context.Background()
		for _, o := range owners {
			_, _ = s.pool.Exec(ctx, `DELETE FROM "LineLink" WHERE "ownerId" = $1`, o)
			_, _ = s.pool.Exec(ctx, `DELETE FROM "LineLinkCode" WHERE "ownerId" = $1`, o)
			_, _ = s.pool.Exec(ctx, `DELETE FROM "LineMessage" WHERE "ownerId" = $1`, o)
		}
		for _, u := range lineUsers {
			_, _ = s.pool.Exec(ctx, `DELETE FROM "LineLink" WHERE "lineUserId" = $1`, u)
		}
	})
}

// linkLine ties lineUser to owner as a member through the code flow.
func linkLine(t *testing.T, s *Store, owner, lineUser string, now time.Time) {
	t.Helper()
	ctx := context.Background()
	hash := "hash-" + newID()
	if err := s.PutLineLinkCode(ctx, owner, "member", hash, now.Add(10*time.Minute)); err != nil {
		t.Fatalf("PutLineLinkCode: %v", err)
	}
	if _, _, err := s.RedeemLineLinkCode(ctx, hash, lineUser, now); err != nil {
		t.Fatalf("RedeemLineLinkCode: %v", err)
	}
}

// newPendingMessage stores a pending correction for owner.
func newPendingMessage(t *testing.T, s *Store, owner, lineUser string, now time.Time) LineMessage {
	t.Helper()
	m, inserted, err := s.InsertLineMessage(context.Background(), LineMessage{
		WebhookEventID: "evt-" + newID(),
		LineUserID:     lineUser,
		OwnerID:        owner,
		Kind:           "correction",
		Text:           "我是学生",
	}, now)
	if err != nil || !inserted {
		t.Fatalf("InsertLineMessage = %v, %v", inserted, err)
	}
	return m
}

func TestRedeemLineLinkCode(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := "password:" + newID()
	lineUser := newLineUser()
	cleanLine(t, s, []string{owner}, lineUser)
	now := fixedNow()

	if err := s.PutLineLinkCode(ctx, owner, "member", "hash-redeem", now.Add(10*time.Minute)); err != nil {
		t.Fatalf("PutLineLinkCode: %v", err)
	}
	link, relinked, err := s.RedeemLineLinkCode(ctx, "hash-redeem", lineUser, now)
	if err != nil {
		t.Fatalf("RedeemLineLinkCode: %v", err)
	}
	if link.LineUserID != lineUser || link.OwnerID != owner || link.Role != "member" || link.CreatedAt.IsZero() {
		t.Errorf("link = %+v", link)
	}
	if relinked {
		t.Error("relinked = true, want false")
	}
	if n := countRows(t, s, `SELECT count(*) FROM "LineLinkCode" WHERE "ownerId" = $1`, owner); n != 0 {
		t.Errorf("codes left = %d, want 0", n)
	}

	got, err := s.FindLineLink(ctx, lineUser)
	if err != nil || got.OwnerID != owner {
		t.Errorf("FindLineLink = %+v, %v", got, err)
	}
	if ok, err := s.LineLinked(ctx, owner); err != nil || !ok {
		t.Errorf("LineLinked = %v, %v, want true", ok, err)
	}
	if _, err := s.FindLineLink(ctx, newLineUser()); !errors.Is(err, ErrNotFound) {
		t.Errorf("FindLineLink unknown = %v, want ErrNotFound", err)
	}

	// The code is single-use.
	if _, _, err := s.RedeemLineLinkCode(ctx, "hash-redeem", lineUser, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("second redeem = %v, want ErrNotFound", err)
	}
}

func TestRedeemLineLinkCodeExpired(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := "password:" + newID()
	lineUser := newLineUser()
	cleanLine(t, s, []string{owner}, lineUser)
	now := fixedNow()

	if err := s.PutLineLinkCode(ctx, owner, "member", "hash-expired", now.Add(-time.Second)); err != nil {
		t.Fatalf("PutLineLinkCode: %v", err)
	}
	if _, _, err := s.RedeemLineLinkCode(ctx, "hash-expired", lineUser, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("redeem expired = %v, want ErrNotFound", err)
	}
	if _, err := s.FindLineLink(ctx, lineUser); !errors.Is(err, ErrNotFound) {
		t.Errorf("link created for expired code: %v", err)
	}
}

func TestRedeemLineLinkCodeMovesLinks(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	now := fixedNow()

	t.Run("owner moves to another LINE", func(t *testing.T) {
		a := "password:" + newID()
		x, y := newLineUser(), newLineUser()
		cleanLine(t, s, []string{a}, x, y)
		linkLine(t, s, a, x, now)

		if err := s.PutLineLinkCode(ctx, a, "member", "hash-move-a", now.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
		link, relinked, err := s.RedeemLineLinkCode(ctx, "hash-move-a", y, now)
		if err != nil {
			t.Fatalf("RedeemLineLinkCode: %v", err)
		}
		if relinked || link.LineUserID != y || link.OwnerID != a {
			t.Errorf("link = %+v, relinked = %v", link, relinked)
		}
		if _, err := s.FindLineLink(ctx, x); !errors.Is(err, ErrNotFound) {
			t.Errorf("old link of x = %v, want ErrNotFound", err)
		}
		if got, err := s.FindLineLink(ctx, y); err != nil || got.OwnerID != a {
			t.Errorf("FindLineLink(y) = %+v, %v", got, err)
		}
	})

	t.Run("LINE switches owner", func(t *testing.T) {
		a, b := "password:"+newID(), "password:"+newID()
		y := newLineUser()
		cleanLine(t, s, []string{a, b}, y)
		linkLine(t, s, b, y, now)

		if err := s.PutLineLinkCode(ctx, a, "member", "hash-switch-a", now.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
		link, relinked, err := s.RedeemLineLinkCode(ctx, "hash-switch-a", y, now)
		if err != nil {
			t.Fatalf("RedeemLineLinkCode: %v", err)
		}
		if !relinked || link.OwnerID != a {
			t.Errorf("link = %+v, relinked = %v, want owner a and relinked", link, relinked)
		}
		if ok, err := s.LineLinked(ctx, b); err != nil || ok {
			t.Errorf("LineLinked(b) = %v, %v, want false", ok, err)
		}
		if got, err := s.FindLineLink(ctx, y); err != nil || got.OwnerID != a {
			t.Errorf("FindLineLink(y) = %+v, %v", got, err)
		}
	})
}

func TestDeleteLineLink(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	now := fixedNow()
	a, b := "password:"+newID(), "password:"+newID()
	x, y := newLineUser(), newLineUser()
	cleanLine(t, s, []string{a, b}, x, y)
	linkLine(t, s, a, x, now)
	linkLine(t, s, b, y, now)

	if err := s.DeleteLineLinkByOwner(ctx, a); err != nil {
		t.Fatalf("DeleteLineLinkByOwner: %v", err)
	}
	if ok, _ := s.LineLinked(ctx, a); ok {
		t.Error("a still linked")
	}
	if err := s.DeleteLineLinkByOwner(ctx, a); err != nil {
		t.Errorf("DeleteLineLinkByOwner without link = %v, want nil", err)
	}
	if err := s.DeleteLineLink(ctx, y); err != nil {
		t.Fatalf("DeleteLineLink: %v", err)
	}
	if ok, _ := s.LineLinked(ctx, b); ok {
		t.Error("b still linked")
	}
}

func TestPutLineLinkCodeReplaces(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := "password:" + newID()
	lineUser := newLineUser()
	cleanLine(t, s, []string{owner}, lineUser)
	now := fixedNow()

	for _, h := range []string{"hash-first", "hash-second"} {
		if err := s.PutLineLinkCode(ctx, owner, "member", h, now.Add(10*time.Minute)); err != nil {
			t.Fatalf("PutLineLinkCode(%s): %v", h, err)
		}
	}
	if _, _, err := s.RedeemLineLinkCode(ctx, "hash-first", lineUser, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("redeem replaced code = %v, want ErrNotFound", err)
	}
	if _, _, err := s.RedeemLineLinkCode(ctx, "hash-second", lineUser, now); err != nil {
		t.Fatalf("redeem current code: %v", err)
	}
}

func TestInsertLineMessageOnce(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := "password:" + newID()
	lineUser := newLineUser()
	cleanLine(t, s, []string{owner})
	now := fixedNow()
	event := "evt-" + newID()

	first, inserted, err := s.InsertLineMessage(ctx, LineMessage{
		WebhookEventID: event, LineUserID: lineUser, OwnerID: owner, Kind: "translation", Text: "hello",
	}, now)
	if err != nil || !inserted {
		t.Fatalf("first insert = %v, %v", inserted, err)
	}
	if first.ID == "" || first.Status != LineStatusPending || first.Attempts != 0 || first.Text != "hello" ||
		first.Kind != "translation" || first.EntryID != nil || !first.CreatedAt.Equal(now) || !first.UpdatedAt.Equal(now) {
		t.Errorf("first = %+v", first)
	}

	second, inserted, err := s.InsertLineMessage(ctx, LineMessage{
		WebhookEventID: event, LineUserID: lineUser, OwnerID: owner, Kind: "correction", Text: "other",
	}, now.Add(time.Minute))
	if err != nil || inserted {
		t.Fatalf("second insert = %v, %v, want false", inserted, err)
	}
	if second.ID != first.ID || second.Text != "hello" || second.Kind != "translation" {
		t.Errorf("second = %+v, want the first row %+v", second, first)
	}
	if n := countRows(t, s, `SELECT count(*) FROM "LineMessage" WHERE "webhookEventId" = $1`, event); n != 1 {
		t.Errorf("rows = %d, want 1", n)
	}
}

func TestStartLineMessageAttemptStopsAtTwo(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := "password:" + newID()
	cleanLine(t, s, []string{owner})
	now := fixedNow()
	m := newPendingMessage(t, s, owner, newLineUser(), now)

	for want := 1; want <= 2; want++ {
		got, err := s.StartLineMessageAttempt(ctx, m.ID, now)
		if err != nil {
			t.Fatalf("attempt %d: %v", want, err)
		}
		if got.Attempts != want || got.Text != "我是学生" || got.Status != LineStatusPending {
			t.Errorf("attempt %d = %+v", want, got)
		}
	}
	if _, err := s.StartLineMessageAttempt(ctx, m.ID, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("third attempt = %v, want ErrNotFound", err)
	}

	done := newPendingMessage(t, s, owner, newLineUser(), now)
	if _, err := s.CompleteLineMessage(ctx, done.ID, owner, draft("x"), now); err != nil {
		t.Fatalf("CompleteLineMessage: %v", err)
	}
	if _, err := s.StartLineMessageAttempt(ctx, done.ID, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("attempt on done row = %v, want ErrNotFound", err)
	}
	if _, err := s.StartLineMessageAttempt(ctx, "missing", now); !errors.Is(err, ErrNotFound) {
		t.Errorf("attempt on unknown row = %v, want ErrNotFound", err)
	}
}

func TestCompleteLineMessage(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	cleanLine(t, s, []string{owner})
	now := fixedNow()
	m := newPendingMessage(t, s, owner, newLineUser(), now)

	d := EntryDraft{
		Kind:          "translation",
		OriginalText:  "I am a student",
		CorrectedText: "我是学生",
		Pinyin:        "wǒ shì xuésheng",
		Hints:         []string{"是 links two nouns", "学生 = student"},
	}
	entry, err := s.CompleteLineMessage(ctx, m.ID, owner, d, now.Add(time.Second))
	if err != nil {
		t.Fatalf("CompleteLineMessage: %v", err)
	}

	got, err := s.GetEntry(ctx, owner, entry.ID)
	if err != nil {
		t.Fatalf("GetEntry: %v", err)
	}
	if got.Kind != "translation" || got.OriginalText != d.OriginalText || got.CorrectedText != d.CorrectedText || got.Pinyin != d.Pinyin {
		t.Errorf("entry = %+v", got)
	}
	if len(got.Hints) != 2 || got.Hints[0].Content != d.Hints[0] || got.Hints[1].Position != 1 {
		t.Errorf("hints = %+v", got.Hints)
	}
	if len(entry.Hints) != 2 {
		t.Errorf("returned hints = %+v", entry.Hints)
	}

	var fileName string
	var rowCount int
	if err := s.pool.QueryRow(ctx,
		`SELECT b."fileName", b."rowCount" FROM "ImportBatch" b JOIN "LearningEntry" e ON e."batchId" = b."id" WHERE e."id" = $1`,
		entry.ID).Scan(&fileName, &rowCount); err != nil {
		t.Fatalf("query batch: %v", err)
	}
	if fileName != "LINE" || rowCount != 1 {
		t.Errorf("batch = %q x%d, want LINE x1", fileName, rowCount)
	}

	var status string
	var entryID, text *string
	if err := s.pool.QueryRow(ctx,
		`SELECT "status", "entryId", "text" FROM "LineMessage" WHERE "id" = $1`, m.ID).Scan(&status, &entryID, &text); err != nil {
		t.Fatalf("query message: %v", err)
	}
	if status != LineStatusDone || entryID == nil || *entryID != entry.ID || text != nil {
		t.Errorf("message = %q, %v, %v", status, entryID, text)
	}

	// A row that is no longer pending creates nothing.
	if _, err := s.CompleteLineMessage(ctx, m.ID, owner, d, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("second complete = %v, want ErrNotFound", err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM "LearningEntry" WHERE "ownerId" = $1`, owner); n != 1 {
		t.Errorf("entries = %d, want 1", n)
	}
}

func TestFailLineMessage(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := "password:" + newID()
	cleanLine(t, s, []string{owner})
	now := fixedNow()
	m := newPendingMessage(t, s, owner, newLineUser(), now)

	if err := s.FailLineMessage(ctx, m.ID, now); err != nil {
		t.Fatalf("FailLineMessage: %v", err)
	}
	var status string
	var text *string
	if err := s.pool.QueryRow(ctx, `SELECT "status", "text" FROM "LineMessage" WHERE "id" = $1`, m.ID).Scan(&status, &text); err != nil {
		t.Fatal(err)
	}
	if status != LineStatusFailed || text != nil {
		t.Errorf("message = %q, %v", status, text)
	}
	if _, err := s.StartLineMessageAttempt(ctx, m.ID, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("attempt on failed row = %v, want ErrNotFound", err)
	}
}

func TestListStaleLineMessages(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := "password:" + newID()
	lineUser := newLineUser()
	cleanLine(t, s, []string{owner})
	now := fixedNow()

	old := newPendingMessage(t, s, owner, lineUser, now.Add(-20*time.Minute))
	older := newPendingMessage(t, s, owner, lineUser, now.Add(-30*time.Minute))
	newPendingMessage(t, s, owner, lineUser, now.Add(-time.Minute))
	failed := newPendingMessage(t, s, owner, lineUser, now.Add(-40*time.Minute))
	if err := s.FailLineMessage(ctx, failed.ID, now); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListStaleLineMessages(ctx, now.Add(-5*time.Minute), 1000)
	if err != nil {
		t.Fatalf("ListStaleLineMessages: %v", err)
	}
	var mine []string
	for _, m := range got {
		if m.OwnerID == owner {
			mine = append(mine, m.ID)
		}
	}
	if len(mine) != 2 || mine[0] != older.ID || mine[1] != old.ID {
		t.Errorf("stale = %v, want [%s %s]", mine, older.ID, old.ID)
	}

	limited, err := s.ListStaleLineMessages(ctx, now.Add(-5*time.Minute), 1)
	if err != nil || len(limited) != 1 {
		t.Errorf("limited = %d, %v, want 1", len(limited), err)
	}
}

func TestPruneLine(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := "password:" + newID()
	other := "password:" + newID()
	cleanLine(t, s, []string{owner, other})
	now := fixedNow()
	lineUser := newLineUser()

	age := func(m LineMessage, status string, by time.Duration) {
		t.Helper()
		if _, err := s.pool.Exec(ctx,
			`UPDATE "LineMessage" SET "status" = $2, "updatedAt" = $3 WHERE "id" = $1`, m.ID, status, dbTime(now.Add(-by))); err != nil {
			t.Fatal(err)
		}
	}
	oldDone := newPendingMessage(t, s, owner, lineUser, now)
	age(oldDone, LineStatusDone, 8*24*time.Hour)
	oldFailed := newPendingMessage(t, s, owner, lineUser, now)
	age(oldFailed, LineStatusFailed, 8*24*time.Hour)
	recentDone := newPendingMessage(t, s, owner, lineUser, now)
	age(recentDone, LineStatusDone, 6*24*time.Hour)
	oldPending := newPendingMessage(t, s, owner, lineUser, now)
	age(oldPending, LineStatusPending, 8*24*time.Hour)

	if err := s.PutLineLinkCode(ctx, owner, "member", "hash-prune-expired", now.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := s.PutLineLinkCode(ctx, other, "member", "hash-prune-valid", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}

	if err := s.PruneLine(ctx, now); err != nil {
		t.Fatalf("PruneLine: %v", err)
	}

	exists := func(id string) bool {
		return countRows(t, s, `SELECT count(*) FROM "LineMessage" WHERE "id" = $1`, id) == 1
	}
	if exists(oldDone.ID) || exists(oldFailed.ID) {
		t.Error("done/failed rows older than 7 days were kept")
	}
	if !exists(recentDone.ID) || !exists(oldPending.ID) {
		t.Error("recent done or pending row was deleted")
	}
	if n := countRows(t, s, `SELECT count(*) FROM "LineLinkCode" WHERE "codeHash" = 'hash-prune-expired'`); n != 0 {
		t.Error("expired code was kept")
	}
	if n := countRows(t, s, `SELECT count(*) FROM "LineLinkCode" WHERE "codeHash" = 'hash-prune-valid'`); n != 1 {
		t.Error("valid code was deleted")
	}
}
