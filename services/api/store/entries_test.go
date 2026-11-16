package store

import (
	"context"
	"testing"
)

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
