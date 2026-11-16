package store

import (
	"context"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// vocabularyOwner is a new owner whose words and review items are removed
// after the test.
func vocabularyOwner(t *testing.T, s *Store) string {
	t.Helper()
	owner := reviewOwner(t, s)
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "VocabularyEntry" WHERE "ownerId" = $1`, owner)
	})
	return owner
}

func word(w, meaning string) VocabularyEntry {
	return VocabularyEntry{ID: newUUID(), Language: "zh", Word: w, Pinyin: "pīnyīn", Meaning: meaning}
}

// addWord saves e for the owner with a new review card due at now, as the
// web's vocabulary book does.
func addWord(t *testing.T, s *Store, owner string, e VocabularyEntry, now time.Time) {
	t.Helper()
	ctx := context.Background()
	now = dbTime(now)
	var source *string
	if e.SourceEntryID != "" {
		source = &e.SourceEntryID
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO "VocabularyEntry"
 ("id", "ownerId", "language", "word", "pinyin", "meaning", "sourceEntryId", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
		e.ID, owner, e.Language, e.Word, e.Pinyin, e.Meaning, source, now); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO "ReviewItem"
 ("id", "ownerId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $6)`,
		newID(), owner, e.Language, ReviewKindVocabulary, e.ID, now, int(review.New)); err != nil {
		t.Fatal(err)
	}
}

func TestDueVocabularyCarriesItsWord(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := vocabularyOwner(t, s), vocabularyOwner(t, s)
	now := fixedNow()

	e := word("认真", "まじめに")
	e.SourceEntryID = "centry0000000000000000001"
	addWord(t, s, a, e, now)

	due, err := s.ListDueReviewItems(ctx, a, now, 10)
	if err != nil || len(due) != 1 || due[0].Kind != ReviewKindVocabulary || due[0].TargetID != e.ID || due[0].Vocabulary == nil {
		t.Fatalf("due = %+v, %v", due, err)
	}
	if v := *due[0].Vocabulary; v.Word != "认真" || v.Meaning != "まじめに" || v.SourceEntryID != e.SourceEntryID ||
		!v.CreatedAt.Equal(dbTime(now)) {
		t.Errorf("word = %+v", v)
	}
	if other, _ := s.ListDueReviewItems(ctx, b, now, 10); len(other) != 0 {
		t.Errorf("another owner sees %+v", other)
	}
}
