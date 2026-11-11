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

func TestEnqueueBringsAMissedItemForward(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	tgt := []ReviewTarget{target("complement", "result-01")}
	if _, err := s.EnqueueReviewItems(ctx, a, tgt, now); err != nil {
		t.Fatal(err)
	}
	due, _ := s.ListDueReviewItems(ctx, a, now, 10)
	answered, err := s.RecordReview(ctx, a, due[0].ID, newUUID(), review.Easy, now)
	if err != nil || !answered.Due.After(now.Add(24*time.Hour)) {
		t.Fatalf("answered = %+v, %v", answered, err)
	}

	// Missed again in practice an hour later: due then, its memory kept.
	later := now.Add(time.Hour)
	if n, err := s.EnqueueReviewItems(ctx, a, tgt, later); err != nil || n != 1 {
		t.Fatalf("enqueue again = %d, %v", n, err)
	}
	again, _ := s.ListDueReviewItems(ctx, a, later, 10)
	if len(again) != 1 || !again[0].Due.Equal(dbTime(later)) || again[0].Reps != answered.Reps ||
		again[0].Stability != answered.Stability || again[0].State != answered.State {
		t.Fatalf("brought forward = %+v, was %+v", again, answered)
	}
	// Already due, it stays where it is.
	if n, err := s.EnqueueReviewItems(ctx, a, tgt, later.Add(time.Hour)); err != nil || n != 0 {
		t.Fatalf("enqueue while due = %d, %v", n, err)
	}
}

func TestReviewStreakCountsDaysInJapanTime(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	// 2026-10-20 23:30 JST.
	now := time.Date(2026, 10, 20, 14, 30, 0, 0, time.UTC)
	if n, err := s.ReviewStreak(ctx, a, now); err != nil || n != 0 {
		t.Fatalf("no reviews = %d, %v", n, err)
	}
	if _, err := s.EnqueueReviewItems(ctx, a, []ReviewTarget{target("complement", "result-01")}, now.AddDate(0, 0, -5)); err != nil {
		t.Fatal(err)
	}
	due, _ := s.ListDueReviewItems(ctx, a, now, 10)
	// Answers on Oct 18, 19 (00:10 JST, still Oct 18 in UTC) and 20, JST.
	for _, at := range []time.Time{
		time.Date(2026, 10, 18, 3, 0, 0, 0, time.UTC),
		time.Date(2026, 10, 18, 15, 10, 0, 0, time.UTC),
		time.Date(2026, 10, 20, 1, 0, 0, 0, time.UTC),
	} {
		if _, err := s.pool.Exec(ctx, `INSERT INTO "ReviewLog"
 ("id", "ownerId", "itemId", "rating", "state", "due", "stability", "difficulty", "scheduledDays", "reviewedAt")
 VALUES ($1, $2, $3, 3, 0, $4, 0, 0, 0, $4)`, newUUID(), a, due[0].ID, dbTime(at)); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := s.ReviewStreak(ctx, a, now); err != nil || n != 3 {
		t.Errorf("streak on Oct 20 = %d, %v", n, err)
	}
	// Oct 21 JST without a review yet: the streak still stands.
	if n, _ := s.ReviewStreak(ctx, a, now.Add(2*time.Hour)); n != 3 {
		t.Errorf("streak on Oct 21 = %d", n)
	}
	// Oct 22 JST: a whole day missed.
	if n, _ := s.ReviewStreak(ctx, a, now.Add(26*time.Hour)); n != 0 {
		t.Errorf("streak on Oct 22 = %d", n)
	}
}

func TestStreakFrom(t *testing.T) {
	day := func(m time.Month, d int) time.Time { return time.Date(2026, m, d, 0, 0, 0, 0, time.UTC) }
	today := time.Date(2026, 11, 1, 0, 0, 0, 0, jst)
	for name, tc := range map[string]struct {
		days []time.Time
		want int
	}{
		"none":              {nil, 0},
		"today only":        {[]time.Time{day(11, 1)}, 1},
		"yesterday only":    {[]time.Time{day(10, 31)}, 1},
		"across the month":  {[]time.Time{day(11, 1), day(10, 31), day(10, 30)}, 3},
		"a gap":             {[]time.Time{day(11, 1), day(10, 30)}, 1},
		"two days ago":      {[]time.Time{day(10, 30), day(10, 29)}, 0},
		"from yesterday on": {[]time.Time{day(10, 31), day(10, 30), day(10, 28)}, 2},
	} {
		if got := streakFrom(today, tc.days); got != tc.want {
			t.Errorf("%s: streak = %d, want %d", name, got, tc.want)
		}
	}
}

func TestCountDueReviewItemsByKind(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	now := fixedNow()
	if got, err := s.CountDueReviewItemsByKind(ctx, a, now); err != nil || len(got) != 0 {
		t.Fatalf("nothing queued = %v, %v", got, err)
	}
	if _, err := s.EnqueueReviewItems(ctx, a, []ReviewTarget{
		target("preposition", "P001:学校"), target("complement", "result-01"), target("complement", "result-02"),
	}, now); err != nil {
		t.Fatal(err)
	}
	// One queued for later is not due yet.
	if _, err := s.EnqueueReviewItems(ctx, a, []ReviewTarget{target("complement", "result-03")}, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	got, err := s.CountDueReviewItemsByKind(ctx, a, now)
	if err != nil || len(got) != 2 || got["preposition"] != 1 || got["complement"] != 2 {
		t.Errorf("by kind = %v, %v", got, err)
	}
}

func TestReviewDaysSaysWhichOfTheLastDaysHadAReview(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := reviewOwner(t, s)
	// 2026-10-20 23:30 JST.
	now := time.Date(2026, 10, 20, 14, 30, 0, 0, time.UTC)
	if days, err := s.ReviewDays(ctx, a, now, 7); err != nil || len(days) != 7 || days[6] {
		t.Fatalf("no reviews = %v, %v", days, err)
	}
	if _, err := s.EnqueueReviewItems(ctx, a, []ReviewTarget{target("complement", "result-01")}, now.AddDate(0, 0, -10)); err != nil {
		t.Fatal(err)
	}
	due, _ := s.ListDueReviewItems(ctx, a, now, 10)
	// Oct 12 JST (before the 7 days), Oct 15 and Oct 20 JST (Oct 19 15:10 UTC is 00:10 Oct 20 JST).
	for _, at := range []time.Time{
		time.Date(2026, 10, 12, 3, 0, 0, 0, time.UTC),
		time.Date(2026, 10, 15, 3, 0, 0, 0, time.UTC),
		time.Date(2026, 10, 19, 15, 10, 0, 0, time.UTC),
	} {
		if _, err := s.pool.Exec(ctx, `INSERT INTO "ReviewLog"
 ("id", "ownerId", "itemId", "rating", "state", "due", "stability", "difficulty", "scheduledDays", "reviewedAt")
 VALUES ($1, $2, $3, 3, 0, $4, 0, 0, 0, $4)`, newUUID(), a, due[0].ID, dbTime(at)); err != nil {
			t.Fatal(err)
		}
	}
	days, err := s.ReviewDays(ctx, a, now, 7)
	// Oct 14 to Oct 20.
	want := []bool{false, true, false, false, false, false, true}
	if err != nil || len(days) != 7 {
		t.Fatalf("days = %v, %v", days, err)
	}
	for i := range want {
		if days[i] != want[i] {
			t.Errorf("days = %v, want %v", days, want)
			break
		}
	}
}
