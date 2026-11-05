package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

// cleanComplementRecords removes the owners' rounds when the test ends.
func cleanComplementRecords(t *testing.T, s *Store, owners ...string) {
	t.Helper()
	t.Cleanup(func() {
		for _, o := range owners {
			_, _ = s.pool.Exec(context.Background(), `DELETE FROM "ComplementPracticeRecord" WHERE "ownerId" = $1`, o)
		}
	})
}

func complementRecord(startedAt time.Time, misses ...[]string) ComplementRecord {
	r := ComplementRecord{ComplementRecordSummary: ComplementRecordSummary{
		ID:        newUUID(),
		Mode:      "result",
		ElapsedMs: 83_250,
		StartedAt: startedAt,
	}}
	for _, m := range misses {
		r.Questions = append(r.Questions, ComplementQuestion{Answer: "在", Noun: "学校", Prompt: "（　）学校学习", Misses: m})
	}
	return r
}

func TestAddComplementRecordCountsFromTheQuestions(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	cleanComplementRecords(t, s, owner)

	r := complementRecord(fixedNow().Add(-2*time.Minute), nil, []string{"把", "被"}, []string{}, []string{"对"})
	r.QuestionCount, r.FirstTryCount, r.MissCount = 99, 99, 99 // must be ignored
	saved, err := s.AddComplementRecord(ctx, owner, r, fixedNow())
	if err != nil {
		t.Fatal(err)
	}
	if saved.QuestionCount != 4 || saved.FirstTryCount != 2 || saved.MissCount != 3 || saved.ElapsedMs != 83_250 {
		t.Errorf("counts = %+v", saved.ComplementRecordSummary)
	}
	if !saved.StartedAt.Equal(dbTime(r.StartedAt)) || !saved.CreatedAt.Equal(dbTime(fixedNow())) {
		t.Errorf("times = %v / %v", saved.StartedAt, saved.CreatedAt)
	}
	if r.Questions[0].Misses != nil {
		t.Error("the caller's questions changed")
	}
	got, err := s.GetComplementRecord(ctx, owner, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Questions[0].Misses == nil || len(got.Questions[0].Misses) != 0 {
		t.Errorf("nil misses saved as %#v, want []", got.Questions[0].Misses)
	}
	if !reflect.DeepEqual(got, saved) || !reflect.DeepEqual(got.Questions[1].Misses, []string{"把", "被"}) {
		t.Errorf("got %+v, saved %+v", got, saved)
	}
}

func TestAddComplementRecordTwiceKeepsTheFirst(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	cleanComplementRecords(t, s, a, b)

	r := complementRecord(fixedNow(), nil)
	if _, err := s.AddComplementRecord(ctx, a, r, fixedNow()); err != nil {
		t.Fatal(err)
	}
	again := r
	again.Mode = "degree" // retries preserve the original mode, too
	again.Questions = []ComplementQuestion{{Answer: "把", Noun: "门", Prompt: "（　）门关上", Misses: []string{"在"}}}
	saved, err := s.AddComplementRecord(ctx, a, again, fixedNow().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if saved.Mode != "result" || saved.MissCount != 0 || saved.Questions[0].Answer != "在" || !saved.CreatedAt.Equal(dbTime(fixedNow())) {
		t.Errorf("second save changed the round: %+v", saved)
	}
	if _, err := s.AddComplementRecord(ctx, b, again, fixedNow()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner's save err = %v, want ErrNotFound", err)
	}
	if _, err := s.GetComplementRecord(ctx, b, r.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("other owner's get err = %v", err)
	}
}

func TestListComplementRecordsIsNewestFirstAndOwnersOnly(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	cleanComplementRecords(t, s, a, b)
	base := fixedNow()

	var ids []string
	for i := range 3 {
		r := complementRecord(base, nil)
		if _, err := s.AddComplementRecord(ctx, a, r, base.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, r.ID)
	}
	if _, err := s.AddComplementRecord(ctx, b, complementRecord(base, nil), base.Add(5*time.Hour)); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListComplementRecords(ctx, a, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != ids[2] || got[1].ID != ids[1] {
		t.Fatalf("got %+v, want ids %v then %v", got, ids[2], ids[1])
	}
	if got[0].QuestionCount != 1 || got[0].FirstTryCount != 1 {
		t.Errorf("summary = %+v", got[0])
	}
	empty, err := s.ListComplementRecords(ctx, newOwner(t, s), 10)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Errorf("empty list = %#v, %v", empty, err)
	}
}
