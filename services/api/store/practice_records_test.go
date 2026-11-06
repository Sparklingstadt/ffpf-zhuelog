package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

// cleanPracticeRecords removes the owners' rounds when the test ends.
func cleanPracticeRecords(t *testing.T, s *Store, owners ...string) {
	t.Helper()
	t.Cleanup(func() {
		for _, o := range owners {
			_, _ = s.pool.Exec(context.Background(), `DELETE FROM "PracticeRecord" WHERE "ownerId" = $1`, o)
		}
	})
}

func practiceRecord(startedAt time.Time, misses ...[]string) PracticeRecord {
	r := PracticeRecord{PracticeRecordSummary: PracticeRecordSummary{
		ID:        newUUID(),
		ElapsedMs: 83_250,
		StartedAt: startedAt,
	}}
	for _, m := range misses {
		r.Questions = append(r.Questions, PracticeQuestion{Answer: "在", Headword: "学校", Prompt: "（　）学校学习", Misses: m})
	}
	return r
}

func TestAddPracticeRecordCountsFromTheQuestions(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	cleanPracticeRecords(t, s, owner)

	r := practiceRecord(fixedNow().Add(-2*time.Minute), nil, []string{"把", "被"}, []string{}, []string{"对"})
	r.QuestionCount, r.FirstTryCount, r.MissCount = 99, 99, 99 // must be ignored
	saved, err := s.AddPracticeRecord(ctx, PracticeKindPreposition, owner, r, fixedNow())
	if err != nil {
		t.Fatal(err)
	}
	if saved.QuestionCount != 4 || saved.FirstTryCount != 2 || saved.MissCount != 3 || saved.ElapsedMs != 83_250 {
		t.Errorf("counts = %+v", saved.PracticeRecordSummary)
	}
	if !saved.StartedAt.Equal(dbTime(r.StartedAt)) || !saved.CreatedAt.Equal(dbTime(fixedNow())) {
		t.Errorf("times = %v / %v", saved.StartedAt, saved.CreatedAt)
	}
	if r.Questions[0].Misses != nil {
		t.Error("the caller's questions changed")
	}
	got, err := s.GetPracticeRecord(ctx, PracticeKindPreposition, owner, r.ID)
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

func TestAddPracticeRecordTwiceKeepsTheFirst(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	cleanPracticeRecords(t, s, a, b)

	r := practiceRecord(fixedNow(), nil)
	if _, err := s.AddPracticeRecord(ctx, PracticeKindPreposition, a, r, fixedNow()); err != nil {
		t.Fatal(err)
	}
	again := r
	again.Questions = []PracticeQuestion{{Answer: "把", Headword: "门", Prompt: "（　）门关上", Misses: []string{"在"}}}
	saved, err := s.AddPracticeRecord(ctx, PracticeKindPreposition, a, again, fixedNow().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if saved.MissCount != 0 || saved.Questions[0].Answer != "在" || !saved.CreatedAt.Equal(dbTime(fixedNow())) {
		t.Errorf("second save changed the round: %+v", saved)
	}
	if _, err := s.AddPracticeRecord(ctx, PracticeKindPreposition, b, again, fixedNow()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner's save err = %v, want ErrNotFound", err)
	}
	if _, err := s.GetPracticeRecord(ctx, PracticeKindPreposition, b, r.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("other owner's get err = %v", err)
	}
}

func TestListPracticeRecordsIsNewestFirstAndOwnersOnly(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	cleanPracticeRecords(t, s, a, b)
	base := fixedNow()

	var ids []string
	for i := range 3 {
		r := practiceRecord(base, nil)
		if _, err := s.AddPracticeRecord(ctx, PracticeKindPreposition, a, r, base.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, r.ID)
	}
	if _, err := s.AddPracticeRecord(ctx, PracticeKindPreposition, b, practiceRecord(base, nil), base.Add(5*time.Hour)); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListPracticeRecords(ctx, PracticeKindPreposition, a, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != ids[2] || got[1].ID != ids[1] {
		t.Fatalf("got %+v, want ids %v then %v", got, ids[2], ids[1])
	}
	if got[0].QuestionCount != 1 || got[0].FirstTryCount != 1 {
		t.Errorf("summary = %+v", got[0])
	}
	empty, err := s.ListPracticeRecords(ctx, PracticeKindPreposition, newOwner(t, s), 10)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Errorf("empty list = %#v, %v", empty, err)
	}
}

// A round saved as one kind is not visible as the other, and its id cannot
// be taken over by a save of the other kind.
func TestPracticeRecordsAreKeptApartByKind(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	cleanPracticeRecords(t, s, owner)

	r := practiceRecord(fixedNow(), nil)
	if _, err := s.AddPracticeRecord(ctx, PracticeKindPreposition, owner, r, fixedNow()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetPracticeRecord(ctx, PracticeKindComplement, owner, r.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get as complement err = %v, want ErrNotFound", err)
	}
	if _, err := s.AddPracticeRecord(ctx, PracticeKindComplement, owner, r, fixedNow()); !errors.Is(err, ErrNotFound) {
		t.Errorf("add as complement err = %v, want ErrNotFound", err)
	}
	other := practiceRecord(fixedNow(), []string{"完"})
	other.Questions[0] = PracticeQuestion{Answer: "懂", Headword: "看", Prompt: "看（　）这本书", Misses: []string{"完"}}
	if _, err := s.AddPracticeRecord(ctx, PracticeKindComplement, owner, other, fixedNow().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	for kind, want := range map[PracticeKind]string{PracticeKindPreposition: r.ID, PracticeKindComplement: other.ID} {
		got, err := s.ListPracticeRecords(ctx, kind, owner, 10)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 || got[0].ID != want {
			t.Errorf("%s list = %+v, want only %s", kind, got, want)
		}
	}
	if got, err := s.GetPracticeRecord(ctx, PracticeKindComplement, owner, other.ID); err != nil || got.Questions[0].Headword != "看" {
		t.Errorf("complement get = %+v, %v", got, err)
	}
}
