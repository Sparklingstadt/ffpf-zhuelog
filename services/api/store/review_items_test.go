package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// reviewOwner is a new owner whose review items are removed after the test.
func reviewOwner(t *testing.T, s *Store) string {
	t.Helper()
	owner := newOwner(t, s)
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "ReviewItem" WHERE "ownerId" = $1`, owner)
	})
	return owner
}

func target(kind, id string) ReviewTarget {
	return ReviewTarget{Language: "zh", Kind: kind, TargetID: id}
}

func TestEnqueueReviewItemsAddsEachTargetOnce(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := reviewOwner(t, s), reviewOwner(t, s)
	now := fixedNow()

	added, err := s.EnqueueReviewItems(ctx, a, []ReviewTarget{target("preposition", "P001:学校"), target("complement", "result-01")}, now)
	if err != nil || added != 2 {
		t.Fatalf("enqueue = %d, %v", added, err)
	}
	// Queued again later, the known one keeps its schedule and only the new one is added.
	added, err = s.EnqueueReviewItems(ctx, a, []ReviewTarget{target("complement", "result-01"), target("complement", "result-02")}, now.Add(time.Hour))
	if err != nil || added != 1 {
		t.Fatalf("enqueue again = %d, %v", added, err)
	}
	if added, err := s.EnqueueReviewItems(ctx, b, []ReviewTarget{target("complement", "result-01")}, now); err != nil || added != 1 {
		t.Fatalf("another owner's enqueue = %d, %v", added, err)
	}

	due, err := s.ListDueReviewItems(ctx, a, now.Add(time.Hour), 10)
	if err != nil || len(due) != 3 {
		t.Fatalf("due = %+v, %v", due, err)
	}
	if !due[0].Due.Equal(dbTime(now)) || due[0].State != review.New || due[0].Reps != 0 || !due[0].LastReview.IsZero() {
		t.Errorf("first due = %+v", due[0])
	}
	if !due[2].Due.Equal(dbTime(now.Add(time.Hour))) || due[2].TargetID != "result-02" {
		t.Errorf("newest = %+v", due[2])
	}
	if n, err := s.CountDueReviewItems(ctx, a, now); err != nil || n != 2 {
		t.Errorf("count at now = %d, %v", n, err)
	}
	if list, err := s.ListDueReviewItems(ctx, a, now.Add(-time.Second), 10); err != nil || len(list) != 0 {
		t.Errorf("due before any = %+v, %v", list, err)
	}
}

func TestRecordReviewReschedulesLogsAndIsRetryable(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := reviewOwner(t, s), reviewOwner(t, s)
	now := fixedNow()
	if _, err := s.EnqueueReviewItems(ctx, a, []ReviewTarget{target("complement", "result-01")}, now); err != nil {
		t.Fatal(err)
	}
	due, _ := s.ListDueReviewItems(ctx, a, now, 10)
	item := due[0]

	logID := newUUID()
	answered, err := s.RecordReview(ctx, a, item.ID, logID, review.Good, now)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := review.Next(item.Card, review.Good, dbTime(now))
	if !answered.Due.Equal(dbTime(want.Due)) || answered.Reps != 1 || answered.State != want.State ||
		!answered.LastReview.Equal(dbTime(now)) || !answered.UpdatedAt.Equal(dbTime(now)) {
		t.Errorf("answered = %+v, want card %+v", answered, want)
	}
	if n, _ := s.CountDueReviewItems(ctx, a, now); n != 0 {
		t.Errorf("still due after the answer: %d", n)
	}

	// A retry of the same answer changes nothing.
	again, err := s.RecordReview(ctx, a, item.ID, logID, review.Good, now.Add(time.Minute))
	if err != nil || !again.Due.Equal(answered.Due) || again.Reps != 1 {
		t.Errorf("retry = %+v, %v", again, err)
	}
	var logs int
	var rating, state int
	_ = s.pool.QueryRow(ctx, `SELECT count(*), max("rating"), max("state") FROM "ReviewLog" WHERE "itemId" = $1`, item.ID).
		Scan(&logs, &rating, &state)
	if logs != 1 || rating != int(review.Good) || state != int(review.New) {
		t.Errorf("logs = %d (rating %d, state %d)", logs, rating, state)
	}

	if _, err := s.RecordReview(ctx, b, item.ID, newUUID(), review.Good, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("another owner's answer: %v", err)
	}
	if _, err := s.RecordReview(ctx, a, newID(), newUUID(), review.Good, now); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown item: %v", err)
	}
	if _, err := s.RecordReview(ctx, a, item.ID, newUUID(), review.Rating(5), now.Add(time.Hour)); err == nil || errors.Is(err, ErrNotFound) {
		t.Errorf("invalid rating: %v", err)
	}

	// Deleting the item takes its log with it.
	if _, err := s.pool.Exec(ctx, `DELETE FROM "ReviewItem" WHERE "id" = $1`, item.ID); err != nil {
		t.Fatal(err)
	}
	_ = s.pool.QueryRow(ctx, `SELECT count(*) FROM "ReviewLog" WHERE "id" = $1`, logID).Scan(&logs)
	if logs != 0 {
		t.Errorf("log kept after its item was deleted")
	}
}
