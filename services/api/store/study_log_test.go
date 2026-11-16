package store

import (
	"context"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

func TestStudyLogCountsEachKindByJapanDay(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := vocabularyOwner(t, s), vocabularyOwner(t, s)
	t.Cleanup(func() {
		for _, o := range []string{a, b} {
			_, _ = s.pool.Exec(context.Background(), `DELETE FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1`, o)
			_, _ = s.pool.Exec(context.Background(), `DELETE FROM "ComplementPracticeRecord" WHERE "ownerId" = $1`, o)
		}
	})
	// Nov 1, 10:00 JST and Nov 2, 00:30 JST (still Nov 1 in UTC).
	nov1 := time.Date(2026, 11, 1, 1, 0, 0, 0, time.UTC)
	nov2 := time.Date(2026, 11, 1, 15, 30, 0, 0, time.UTC)

	createEntries(t, s, a, nov1, 2, 0)
	trashed := createEntries(t, s, a, nov2, 2, 0)
	if _, err := s.pool.Exec(ctx, `UPDATE "LearningEntry" SET "deletedAt" = $2 WHERE "id" = $1`, trashed[0].ID, nov2); err != nil {
		t.Fatal(err)
	}
	p := prepositionRecord(nov1, nil, []string{"把"}, nil)
	saveRound(t, s, prepositionPractice, a, p.PrepositionRecordSummary, p.Questions, nov1)
	c := complementRecord(nov2, nil, nil)
	saveRound(t, s, complementPractice, a, c.ComplementRecordSummary, c.Questions, nov2)
	addWord(t, s, a, word("认真", "まじめに"), nov2)
	answerItem(t, s, a, dueItems(t, s, a, nov2)[0].ID, review.Good, nov2)
	// Another owner's activity is not counted.
	createEntries(t, s, b, nov1, 3, 0)

	days, err := s.StudyLog(ctx, a, LogDate{2026, 10, 31}, LogDate{2026, 11, 30})
	if err != nil {
		t.Fatal(err)
	}
	want := []StudyDay{
		{Date: LogDate{2026, 11, 1}, PracticeQuestions: 3, Notes: 2},
		{Date: LogDate{2026, 11, 2}, Reviews: 1, PracticeQuestions: 2, Notes: 1, Words: 1},
	}
	if len(days) != len(want) || days[0] != want[0] || days[1] != want[1] {
		t.Fatalf("study log = %+v, want %+v", days, want)
	}

	// The range is by JST date, both ends included.
	if days, _ := s.StudyLog(ctx, a, LogDate{2026, 11, 2}, LogDate{2026, 11, 2}); len(days) != 1 || days[0].Date != (LogDate{2026, 11, 2}) {
		t.Errorf("Nov 2 only = %+v", days)
	}
	if days, _ := s.StudyLog(ctx, a, LogDate{2026, 11, 3}, LogDate{2026, 11, 30}); len(days) != 0 {
		t.Errorf("after the activity = %+v", days)
	}
}
