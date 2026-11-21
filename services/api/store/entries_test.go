package store

import (
	"context"
	"reflect"
	"strconv"
	"testing"
	"time"
)

func TestCreateImportBatchAndRead(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	now := fixedNow()

	d1 := draft("1", "h0", "h1", "h2")
	d1.Kind = "translation"
	batch, entries, err := s.CreateImportBatch(ctx, owner, "notes.csv", []EntryDraft{d1, draft("2")}, now)
	if err != nil {
		t.Fatalf("CreateImportBatch: %v", err)
	}
	if batch.ID == "" || !batch.ImportedAt.Equal(now) {
		t.Fatalf("batch = %+v, want id and importedAt %v", batch, now)
	}
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}

	var fileName string
	var rowCount int
	if err := s.pool.QueryRow(ctx,
		`SELECT "fileName", "rowCount" FROM "ImportBatch" WHERE id = $1`, batch.ID).Scan(&fileName, &rowCount); err != nil {
		t.Fatalf("query batch: %v", err)
	}
	if want := "notes.csv"; fileName != want {
		t.Errorf("fileName = %q, want %q", fileName, want)
	}
	if rowCount != 2 {
		t.Errorf("rowCount = %d, want 2", rowCount)
	}

	got, ok := liveNote(t, s, owner, entries[0].ID)
	if !ok {
		t.Fatal("the first note is not stored")
	}
	if got.Kind != "translation" || got.OriginalText != "orig 1" || got.CorrectedText != "corr 1" || got.Pinyin != "pin 1" {
		t.Errorf("entry fields = %+v", got)
	}
	if !got.CreatedAt.Equal(now) {
		t.Errorf("CreatedAt = %v, want %v", got.CreatedAt, now)
	}
	if got.SharedAt != nil {
		t.Errorf("SharedAt = %v, want nil", got.SharedAt)
	}
	if len(got.Hints) != 3 {
		t.Fatalf("hints = %d, want 3", len(got.Hints))
	}
	for i, h := range got.Hints {
		if h.Position != i || h.Content != []string{"h0", "h1", "h2"}[i] || h.ID == "" {
			t.Errorf("hint[%d] = %+v", i, h)
		}
	}
	if !reflect.DeepEqual(entries[0], got) {
		t.Errorf("returned entry %+v != fetched %+v", entries[0], got)
	}

	got2, ok := liveNote(t, s, owner, entries[1].ID)
	if !ok {
		t.Fatal("the second note is not stored")
	}
	if len(got2.Hints) != 0 {
		t.Errorf("hints = %d, want 0", len(got2.Hints))
	}
}

func TestCreateImportBatchStoresFileName(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)

	batch, entries, err := s.CreateImportBatch(ctx, owner, "学習ノート.csv", []EntryDraft{draft("1", "h"), draft("2"), draft("3")}, fixedNow())
	if err != nil {
		t.Fatalf("CreateImportBatch: %v", err)
	}
	if len(entries) != 3 || !batch.ImportedAt.Equal(fixedNow()) {
		t.Fatalf("batch = %+v, entries = %d", batch, len(entries))
	}
	var fileName string
	var rowCount int
	if err := s.pool.QueryRow(ctx,
		`SELECT "fileName", "rowCount" FROM "ImportBatch" WHERE id = $1`, batch.ID).Scan(&fileName, &rowCount); err != nil {
		t.Fatalf("query batch: %v", err)
	}
	if fileName != "学習ノート.csv" || rowCount != 3 {
		t.Errorf("fileName = %q, rowCount = %d", fileName, rowCount)
	}
	if got, ok := liveNote(t, s, owner, entries[0].ID); !ok || !reflect.DeepEqual(got, entries[0]) {
		t.Errorf("stored = %+v, %v; want %+v", got, ok, entries[0])
	}
}

func TestCreateImportBatchKeepsRowOrder(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	now := time.Date(2026, 10, 21, 3, 0, 0, 0, time.UTC) // 12:00 JST

	drafts := make([]EntryDraft, 30)
	for i := range drafts {
		drafts[i] = draft(strconv.Itoa(i))
	}
	batch, created, err := s.CreateImportBatch(ctx, owner, "rows.csv", drafts, now)
	if err != nil {
		t.Fatal(err)
	}
	if !batch.ImportedAt.Equal(now) {
		t.Errorf("importedAt = %v, want %v", batch.ImportedAt, now)
	}
	for i, e := range created {
		if want := now.Add(time.Duration(i) * time.Millisecond); !e.CreatedAt.Equal(want) {
			t.Errorf("entry %d createdAt = %v, want %v", i, e.CreatedAt, want)
		}
	}

	// The web lists notes newest first by (createdAt, id).
	listed := liveNotes(t, s, owner)
	if len(listed) != len(drafts) {
		t.Fatalf("listed %d, want %d", len(listed), len(drafts))
	}
	for i := range drafts {
		if j := len(drafts) - 1 - i; listed[j].OriginalText != drafts[i].OriginalText || listed[j].ID != created[i].ID {
			t.Errorf("listed[%d] = %q, want %q", j, listed[j].OriginalText, drafts[i].OriginalText)
		}
	}
}

func TestCreateImportBatchRollsBack(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	now := time.Date(2026, 10, 20, 1, 2, 3, 456_000_000, time.UTC)

	bad := draft("2")
	bad.OriginalText = "a\x00b"
	if _, _, err := s.CreateImportBatch(ctx, owner, "rollback.csv", []EntryDraft{draft("1", "x"), bad}, now); err == nil {
		t.Fatal("CreateImportBatch with NUL char succeeded, want error")
	}

	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM "LearningEntry" WHERE "ownerId" = $1`, owner).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d entries remain after rollback", n)
	}
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM "ImportBatch" WHERE "fileName" = $1 AND "importedAt" = $2`, "rollback.csv", dbTime(now)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d import batches remain after rollback", n)
	}
}

func TestReadsWebCreatedEntry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	batchID, entryID := newID(), newID()

	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "ImportBatch" WHERE id = $1`, batchID)
	})
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO "ImportBatch" (id, "fileName", "rowCount", "importedAt") VALUES ($1, 'web', 1, NOW())`, batchID); err != nil {
		t.Fatal(err)
	}
	// kind and createdAt are omitted so the database defaults apply, as with Prisma.
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO "LearningEntry" (id, "originalText", "correctedText", pinyin, "ownerId", "batchId")
		 VALUES ($1, '原文', '訂正', 'yuan wen', $2, $3)`, entryID, owner, batchID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO "Hint" (id, content, position, "learningEntryId") VALUES ($1, 'first', 0, $3), ($2, 'second', 1, $3)`,
		newID(), newID(), entryID); err != nil {
		t.Fatal(err)
	}

	got, ok := liveNote(t, s, owner, entryID)
	if !ok {
		t.Fatal("the web's note is not read")
	}
	if got.Kind != "correction" || got.OriginalText != "原文" || got.CorrectedText != "訂正" || got.Pinyin != "yuan wen" {
		t.Errorf("entry = %+v", got)
	}
	if len(got.Hints) != 2 || got.Hints[0].Content != "first" || got.Hints[1].Content != "second" {
		t.Errorf("hints = %+v", got.Hints)
	}
	if got.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}
}
