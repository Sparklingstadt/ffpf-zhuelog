package store

import (
	"context"
	"errors"
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

func TestPutVocabularyAddsAWordAndItsCard(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := vocabularyOwner(t, s), vocabularyOwner(t, s)
	now := fixedNow()

	e := word("认真", "まじめに")
	e.SourceEntryID = "centry0000000000000000001"
	saved, err := s.PutVocabulary(ctx, a, e, now)
	if err != nil || saved.Word != "认真" || saved.SourceEntryID != e.SourceEntryID || !saved.CreatedAt.Equal(dbTime(now)) {
		t.Fatalf("put = %+v, %v", saved, err)
	}
	due, err := s.ListDueReviewItems(ctx, a, now, 10)
	if err != nil || len(due) != 1 || due[0].Kind != ReviewKindVocabulary || due[0].TargetID != e.ID ||
		due[0].Vocabulary == nil || due[0].Vocabulary.Meaning != "まじめに" || due[0].State != review.New {
		t.Fatalf("due = %+v, %v", due, err)
	}

	// Saving the id again edits the reading and the meaning, and keeps the card's schedule.
	if _, err := s.RecordReview(ctx, a, due[0].ID, newUUID(), review.Easy, now); err != nil {
		t.Fatal(err)
	}
	edit := e
	edit.Word, edit.Meaning, edit.SourceEntryID = "别的", "真剣に", ""
	edited, err := s.PutVocabulary(ctx, a, edit, now.Add(time.Hour))
	if err != nil || edited.Word != "认真" || edited.Meaning != "真剣に" || edited.SourceEntryID != e.SourceEntryID ||
		!edited.UpdatedAt.Equal(dbTime(now.Add(time.Hour))) || !edited.CreatedAt.Equal(dbTime(now)) {
		t.Fatalf("edit = %+v, %v", edited, err)
	}
	if n, _ := s.CountDueReviewItems(ctx, a, now.Add(time.Hour)); n != 0 {
		t.Errorf("an edit put the card back: %d due", n)
	}

	if _, err := s.PutVocabulary(ctx, a, word("认真", "別の意味"), now); !errors.Is(err, ErrVocabularyExists) {
		t.Errorf("same word under a new id: %v", err)
	}
	if _, err := s.PutVocabulary(ctx, b, e, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("another owner's id: %v", err)
	}
	if _, err := s.PutVocabulary(ctx, b, word("认真", "まじめに"), now); err != nil {
		t.Errorf("another owner's same word: %v", err)
	}

	list, err := s.ListVocabulary(ctx, a, 100)
	if err != nil || len(list) != 1 || list[0].ID != e.ID {
		t.Fatalf("list = %+v, %v", list, err)
	}
}

func TestDeleteVocabularyTakesItsCard(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := vocabularyOwner(t, s), vocabularyOwner(t, s)
	now := fixedNow()
	e := word("认真", "まじめに")
	if _, err := s.PutVocabulary(ctx, a, e, now); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteVocabulary(ctx, b, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("another owner's delete: %v", err)
	}
	if err := s.DeleteVocabulary(ctx, a, e.ID); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.CountDueReviewItems(ctx, a, now); n != 0 {
		t.Errorf("card left after delete: %d", n)
	}
	if err := s.DeleteVocabulary(ctx, a, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete: %v", err)
	}
	if list, _ := s.ListVocabulary(ctx, a, 100); len(list) != 0 {
		t.Errorf("list after delete = %+v", list)
	}
}
