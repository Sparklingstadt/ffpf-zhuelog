package review

import (
	"testing"
	"time"
)

var start = time.Date(2026, 11, 5, 9, 0, 0, 0, time.UTC)

func mustNext(t *testing.T, c Card, r Rating, now time.Time) Card {
	t.Helper()
	next, err := Next(c, r, now)
	if err != nil {
		t.Fatalf("Next(%+v, %d): %v", c, r, err)
	}
	return next
}

// graduate answers Good until the card leaves the learning steps, each
// answer when it falls due, and returns the card and the time of the last
// answer.
func graduate(t *testing.T) (Card, time.Time) {
	t.Helper()
	c, now := NewCard(start), start
	for i := 0; c.State != Reviewing; i++ {
		if i > 10 {
			t.Fatalf("still learning after %d answers: %+v", i, c)
		}
		now = c.Due
		c = mustNext(t, c, Good, now)
	}
	return c, now
}

func TestNewCardIsDueAtOnce(t *testing.T) {
	c := NewCard(start)
	if !c.Due.Equal(start) || c.State != New || c.Reps != 0 || !c.LastReview.IsZero() {
		t.Errorf("NewCard = %+v", c)
	}
}

func TestFirstAnswerSchedulesByRating(t *testing.T) {
	due := map[Rating]time.Time{}
	for _, r := range []Rating{Again, Hard, Good, Easy} {
		c := mustNext(t, NewCard(start), r, start)
		if c.Reps != 1 || !c.LastReview.Equal(start) || !c.Due.After(start) || c.State == New {
			t.Errorf("after %d: %+v", r, c)
		}
		due[r] = c.Due
	}
	if !due[Again].Before(due[Good]) || due[Hard].After(due[Good]) || !due[Good].Before(due[Easy]) {
		t.Errorf("first due by rating = %v", due)
	}
}

func TestGoodAnswersSpreadTheReviews(t *testing.T) {
	c, now := graduate(t)
	prev := c.Due.Sub(now)
	for i := 0; i < 4; i++ {
		now = c.Due
		c = mustNext(t, c, Good, now)
		gap := c.Due.Sub(now)
		if gap <= prev {
			t.Fatalf("review %d: gap %v did not grow past %v", i, gap, prev)
		}
		prev = gap
	}
	if prev < 7*24*time.Hour {
		t.Errorf("after four more Good answers the gap is only %v", prev)
	}
}

func TestAgainOnAReviewCardIsALapse(t *testing.T) {
	c, _ := graduate(t)
	now := c.Due
	again := mustNext(t, c, Again, now)
	if again.Lapses != c.Lapses+1 || again.State != Relearning || !again.Due.Before(now.Add(24*time.Hour)) {
		t.Errorf("Again on %+v = %+v", c, again)
	}
	good := mustNext(t, c, Good, now)
	if good.Lapses != c.Lapses || !again.Due.Before(good.Due) {
		t.Errorf("Good on %+v = %+v", c, good)
	}
}

func TestNextRejectsInvalidInput(t *testing.T) {
	for _, r := range []Rating{0, 5, -1} {
		if _, err := Next(NewCard(start), r, start); err == nil {
			t.Errorf("rating %d accepted", r)
		}
	}
	c := mustNext(t, NewCard(start), Good, start)
	if _, err := Next(c, Good, start.Add(-time.Minute)); err == nil {
		t.Error("an answer before the last review was accepted")
	}
}

func TestNextDuesMatchesEachAnswer(t *testing.T) {
	now := time.Date(2026, 11, 11, 9, 0, 0, 0, time.UTC)
	c := NewCard(now)
	dues, err := NextDues(c, now)
	if err != nil {
		t.Fatal(err)
	}
	for r := Again; r <= Easy; r++ {
		next, err := Next(c, r, now)
		if err != nil {
			t.Fatal(err)
		}
		if !dues[r-1].Equal(next.Due) {
			t.Errorf("rating %d: NextDues = %v, Next = %v", r, dues[r-1], next.Due)
		}
	}
	// A better answer never brings the item back sooner.
	for i := 1; i < 4; i++ {
		if dues[i].Before(dues[i-1]) {
			t.Errorf("due for rating %d (%v) is before rating %d (%v)", i+1, dues[i], i, dues[i-1])
		}
	}
}
