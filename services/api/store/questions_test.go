package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestQuestionsAreSeparatePrivateImmutableAndRetryable(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	t.Cleanup(func() {
		for _, o := range []string{a, b} {
			_, _ = s.pool.Exec(ctx, `DELETE FROM "QuickQuestion" WHERE "ownerId"=$1`, o)
		}
	})
	now := fixedNow()
	q := Question{QuestionSummary: QuestionSummary{ID: newUUID(), Question: "了と过？", ModelName: "test"}, Answer: "違いです"}
	saved, err := s.PutQuestion(ctx, a, q, now)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.PutQuestion(ctx, a, q, now.Add(time.Hour))
	if err != nil || !again.CreatedAt.Equal(saved.CreatedAt) {
		t.Fatalf("retry: %+v %v", again, err)
	}
	if _, err := s.GetQuestion(ctx, b, q.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("read other's: %v", err)
	}
	if _, err := s.PutQuestion(ctx, b, q, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("overwrite other's: %v", err)
	}
	changed := q
	changed.Answer = "changed"
	if _, err := s.PutQuestion(ctx, a, changed, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("overwrite: %v", err)
	}
	list, err := s.ListQuestions(ctx, a, 100)
	if err != nil || len(list) != 1 || list[0].ID != q.ID {
		t.Fatalf("list: %+v %v", list, err)
	}
	list, err = s.ListQuestions(ctx, b, 100)
	if err != nil || len(list) != 0 {
		t.Fatalf("other list: %+v %v", list, err)
	}
	convs, err := s.ListConversations(ctx, a, 100)
	if err != nil || len(convs) != 0 {
		t.Fatalf("mixed with conversations: %+v %v", convs, err)
	}
}
