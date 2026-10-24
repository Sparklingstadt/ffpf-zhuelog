package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

// cleanPrepositionRecords removes the owners' rounds when the test ends.
func cleanPrepositionRecords(t *testing.T, s *Store, owners ...string) {
	t.Helper()
	t.Cleanup(func() {
		for _, o := range owners {
			_, _ = s.pool.Exec(context.Background(), `DELETE FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1`, o)
		}
	})
}

func prepositionRecord(startedAt time.Time, misses ...[]string) PrepositionRecord {
	r := PrepositionRecord{PrepositionRecordSummary: PrepositionRecordSummary{
		ID:        newUUID(),
		ElapsedMs: 83_250,
		StartedAt: startedAt,
	}}
	for _, m := range misses {
		r.Questions = append(r.Questions, PrepositionQuestion{Answer: "在", Noun: "学校", Prompt: "（　）学校学习", Misses: m})
	}
	return r
}

func TestAddPrepositionRecordCountsFromTheQuestions(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	cleanPrepositionRecords(t, s, owner)

	r := prepositionRecord(fixedNow().Add(-2*time.Minute), nil, []string{"把", "被"}, []string{}, []string{"对"})
	r.QuestionCount, r.FirstTryCount, r.MissCount = 99, 99, 99 // must be ignored
	saved, err := s.AddPrepositionRecord(ctx, owner, r, fixedNow())
	if err != nil {
		t.Fatal(err)
	}
	if saved.QuestionCount != 4 || saved.FirstTryCount != 2 || saved.MissCount != 3 || saved.ElapsedMs != 83_250 {
		t.Errorf("counts = %+v", saved.PrepositionRecordSummary)
	}
	if !saved.StartedAt.Equal(dbTime(r.StartedAt)) || !saved.CreatedAt.Equal(dbTime(fixedNow())) {
		t.Errorf("times = %v / %v", saved.StartedAt, saved.CreatedAt)
	}
	if r.Questions[0].Misses != nil {
		t.Error("the caller's questions changed")
	}
	got, err := s.GetPrepositionRecord(ctx, owner, r.ID)
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

func TestAddPrepositionRecordTwiceKeepsTheFirst(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	cleanPrepositionRecords(t, s, a, b)

	r := prepositionRecord(fixedNow(), nil)
	if _, err := s.AddPrepositionRecord(ctx, a, r, fixedNow()); err != nil {
		t.Fatal(err)
	}
	again := r
	again.Questions = []PrepositionQuestion{{Answer: "把", Noun: "门", Prompt: "（　）门关上", Misses: []string{"在"}}}
	saved, err := s.AddPrepositionRecord(ctx, a, again, fixedNow().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if saved.MissCount != 0 || saved.Questions[0].Answer != "在" || !saved.CreatedAt.Equal(dbTime(fixedNow())) {
		t.Errorf("second save changed the round: %+v", saved)
	}
	if _, err := s.AddPrepositionRecord(ctx, b, again, fixedNow()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner's save err = %v, want ErrNotFound", err)
	}
	if _, err := s.GetPrepositionRecord(ctx, b, r.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("other owner's get err = %v", err)
	}
}

func TestListPrepositionRecordsIsNewestFirstAndOwnersOnly(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	cleanPrepositionRecords(t, s, a, b)
	base := fixedNow()

	var ids []string
	for i := range 3 {
		r := prepositionRecord(base, nil)
		if _, err := s.AddPrepositionRecord(ctx, a, r, base.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, r.ID)
	}
	if _, err := s.AddPrepositionRecord(ctx, b, prepositionRecord(base, nil), base.Add(5*time.Hour)); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListPrepositionRecords(ctx, a, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != ids[2] || got[1].ID != ids[1] {
		t.Fatalf("got %+v, want ids %v then %v", got, ids[2], ids[1])
	}
	if got[0].QuestionCount != 1 || got[0].FirstTryCount != 1 {
		t.Errorf("summary = %+v", got[0])
	}
	empty, err := s.ListPrepositionRecords(ctx, newOwner(t, s), 10)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Errorf("empty list = %#v, %v", empty, err)
	}
}
