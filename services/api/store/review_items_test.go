package store

import (
	"context"
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

	due := dueItems(t, s, a, now.Add(time.Hour))
	if len(due) != 3 {
		t.Fatalf("due = %+v", due)
	}
	if c := reviewCard(t, s, a, due[0].ID); !c.Due.Equal(dbTime(now)) || c.State != review.New || c.Reps != 0 || !c.LastReview.IsZero() {
		t.Errorf("first due = %+v", c)
	}
	if c := reviewCard(t, s, a, due[2].ID); !c.Due.Equal(dbTime(now.Add(time.Hour))) || due[2].TargetID != "result-02" {
		t.Errorf("newest = %+v %+v", due[2], c)
	}
	if n := len(dueItems(t, s, a, now)); n != 2 {
		t.Errorf("due at now = %d", n)
	}
	if list := dueItems(t, s, a, now.Add(-time.Second)); len(list) != 0 {
		t.Errorf("due before any = %+v", list)
	}
}

func TestEnqueueBringsAMissedItemForward(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	tgt := []ReviewTarget{target("complement", "result-01")}
	if _, err := s.EnqueueReviewItems(ctx, a, tgt, now); err != nil {
		t.Fatal(err)
	}
	id := dueItems(t, s, a, now)[0].ID
	answerItem(t, s, a, id, review.Easy, now)
	answered := reviewCard(t, s, a, id)
	if !answered.Due.After(now.Add(24 * time.Hour)) {
		t.Fatalf("answered = %+v", answered)
	}

	// Missed again in practice an hour later: due then, its memory kept.
	later := now.Add(time.Hour)
	if n, err := s.EnqueueReviewItems(ctx, a, tgt, later); err != nil || n != 1 {
		t.Fatalf("enqueue again = %d, %v", n, err)
	}
	again := dueItems(t, s, a, later)
	if len(again) != 1 || again[0].ID != id {
		t.Fatalf("brought forward = %+v", again)
	}
	if c := reviewCard(t, s, a, id); !c.Due.Equal(dbTime(later)) || c.Reps != answered.Reps ||
		c.Stability != answered.Stability || c.State != answered.State {
		t.Fatalf("brought forward = %+v, was %+v", c, answered)
	}
	// Already due, it stays where it is.
	if n, err := s.EnqueueReviewItems(ctx, a, tgt, later.Add(time.Hour)); err != nil || n != 0 {
		t.Fatalf("enqueue while due = %d, %v", n, err)
	}
}
