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

// vocabularyEntry is a word an owner picked out to learn, as the web's
// vocabulary book saves it. SourceEntryID is the learning note it came from,
// or empty.
type vocabularyEntry struct {
	ID            string
	Language      string
	Word          string
	Pinyin        string
	Meaning       string
	SourceEntryID string
}

func word(w, meaning string) vocabularyEntry {
	return vocabularyEntry{ID: newUUID(), Language: "zh", Word: w, Pinyin: "pīnyīn", Meaning: meaning}
}

// addWord saves e for the owner with a new review card due at now, as the
// web's vocabulary book does.
func addWord(t *testing.T, s *Store, owner string, e vocabularyEntry, now time.Time) {
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
