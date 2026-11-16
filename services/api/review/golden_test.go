package review

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"testing"
	"time"
)

// The web schedules reviews with its own port of FSRS
// (src/domain/review/fsrs.ts). This file pins both to the same answers: Go
// writes what Next gives for each case to the golden file, and the web's test
// (tests/review-fsrs.test.ts) checks its port against it.
var update = flag.Bool("update", false, "rewrite the FSRS golden file the web's tests read")

const goldenPath = "../../../tests/fixtures/fsrs-golden.json"

type goldenFile struct {
	Cases []goldenCase `json:"cases"`
}

type goldenCase struct {
	Name  string       `json:"name"`
	Start goldenCard   `json:"start"`
	Steps []goldenStep `json:"steps"`
}

// goldenStep is one answer: the card before it is the case's start or the
// previous step's card (the previous card again when that step failed).
type goldenStep struct {
	At     string `json:"at"`
	Rating int    `json:"rating"`
	// When each rating, Again to Easy, would bring the card back; null when
	// FSRS refuses the card or the time.
	NextDues []string    `json:"nextDues"`
	Card     *goldenCard `json:"card"`
	Error    bool        `json:"error"`
}

type goldenCard struct {
	Due            string  `json:"due"`
	Stability      float64 `json:"stability"`
	Difficulty     float64 `json:"difficulty"`
	ScheduledDays  int     `json:"scheduledDays"`
	Reps           int     `json:"reps"`
	Lapses         int     `json:"lapses"`
	State          int     `json:"state"`
	RemainingSteps int     `json:"remainingSteps"`
	LastReview     *string `json:"lastReview"`
}

func goldenTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

func toGoldenCard(c Card) goldenCard {
	out := goldenCard{
		Due:            goldenTime(c.Due),
		Stability:      c.Stability,
		Difficulty:     c.Difficulty,
		ScheduledDays:  c.ScheduledDays,
		Reps:           c.Reps,
		Lapses:         c.Lapses,
		State:          int(c.State),
		RemainingSteps: c.RemainingSteps,
	}
	if !c.LastReview.IsZero() {
		s := goldenTime(c.LastReview)
		out.LastReview = &s
	}
	return out
}

// answer is a step of a case: the rating and when it is given, from the card
// it answers and the time of the previous answer (the case's start before the
// first).
type answer struct {
	rating Rating
	at     func(c Card, prev time.Time) time.Time
}

func atDue(r Rating) answer {
	return answer{r, func(c Card, _ time.Time) time.Time { return c.Due }}
}

func atTime(r Rating, at time.Time) answer {
	return answer{r, func(Card, time.Time) time.Time { return at }}
}

func afterPrevious(r Rating, d time.Duration) answer {
	return answer{r, func(_ Card, prev time.Time) time.Time { return prev.Add(d) }}
}

func afterDue(r Rating, d time.Duration) answer {
	return answer{r, func(c Card, _ time.Time) time.Time { return c.Due.Add(d) }}
}

func repeat(a answer, n int) []answer {
	out := make([]answer, n)
	for i := range out {
		out[i] = a
	}
	return out
}

func concat(parts ...[]answer) []answer {
	var out []answer
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// graduation is two Good answers, each when due: a new card leaves the
// learning steps.
var graduation = repeat(atDue(Good), 2)

func goldenCases(t *testing.T) []goldenCase {
	t.Helper()
	day := 24 * time.Hour
	on := func(hour, minute int) time.Time {
		return time.Date(2026, 11, 5, hour, minute, 0, 0, time.UTC)
	}

	// A graduated card answered Good twice more when due, so that it is next
	// due days ahead. A practice miss brings it forward to the time of the
	// miss (the web's enqueue); here it is answered two days after that,
	// still before the day FSRS had given it.
	reviewed, reviewedAt := graduate(t)
	for range 2 {
		reviewedAt = reviewed.Due
		reviewed = mustNext(t, reviewed, Good, reviewedAt)
	}
	broughtForwardAt := reviewedAt.Add(3 * day)
	if !broughtForwardAt.Before(reviewed.Due) {
		t.Fatalf("the reviewed card is due %v, not after %v", reviewed.Due, broughtForwardAt)
	}
	broughtForward := reviewed
	broughtForward.Due = broughtForwardAt.Add(-2 * day)

	// A review card whose stability was lost: FSRS refuses it.
	invalid := Card{
		Due:           start,
		Stability:     0,
		Difficulty:    5,
		ScheduledDays: 3,
		Reps:          3,
		State:         Reviewing,
		LastReview:    start.Add(-3 * day),
	}

	specs := []struct {
		name    string
		start   Card
		answers []answer
	}{
		{"new-again", NewCard(start), []answer{atDue(Again)}},
		{"new-hard", NewCard(start), []answer{atDue(Hard)}},
		{"new-good", NewCard(start), []answer{atDue(Good)}},
		{"new-easy", NewCard(start), []answer{atDue(Easy)}},
		{"good-path", NewCard(start), repeat(atDue(Good), 8)},
		// Long enough for the interval to reach the 36500-day maximum.
		{"easy-path", NewCard(start), repeat(atDue(Easy), 8)},
		{"hard-in-learning", NewCard(start), []answer{atDue(Hard), atDue(Hard), atDue(Good), atDue(Good)}},
		{"lapse", NewCard(start), concat(graduation, []answer{
			atDue(Again), atDue(Good), atDue(Hard), atDue(Again), atDue(Good),
		})},
		// Relearning: Hard waits 15 minutes and keeps the step; Again
		// starts the step over.
		{"relearning-hard-again", NewCard(start), concat(graduation, []answer{
			atDue(Again), atDue(Hard), atDue(Again), atDue(Good),
		})},
		// Learning, a day after the first answer: Again takes the forget
		// stability, not the short-term one.
		{"learning-again-after-a-day", NewCard(start), []answer{
			atDue(Good), afterPrevious(Again, 24*time.Hour), atDue(Good), atDue(Good),
		}},
		// Learning: Again restarts the steps, Easy graduates at once.
		{"learning-again-easy", NewCard(start), []answer{
			atDue(Again), atDue(Again), atDue(Easy),
		}},
		// An hour after graduating: the same UTC day, so no day has passed.
		{"early-review", NewCard(start), concat(graduation, []answer{afterPrevious(Good, time.Hour)})},
		{"overdue", NewCard(start), concat(graduation, []answer{
			afterDue(Hard, 90*day), afterDue(Again, 90*day), afterDue(Easy, 90*day),
		})},
		// FSRS counts days on UTC dates: 23:59 to 00:01 is one day.
		{"utc-day-boundary", NewCard(start), []answer{
			atTime(Again, on(23, 58)), atTime(Good, on(23, 59)),
			atTime(Good, time.Date(2026, 11, 6, 0, 1, 0, 0, time.UTC)),
		}},
		// 14:59Z to 15:01Z crosses midnight in Japan but not in UTC: no day.
		{"jst-midnight-same-utc-day", NewCard(start), []answer{
			atTime(Again, on(14, 58)), atTime(Good, on(14, 59)), atTime(Good, on(15, 1)),
		}},
		{"brought-forward", broughtForward, []answer{atTime(Good, broughtForwardAt)}},
		{"errors", mustNext(t, NewCard(start), Good, start), []answer{
			afterPrevious(0, 10*time.Minute),
			afterPrevious(5, 10*time.Minute),
			afterPrevious(Good, -time.Minute),
		}},
		{"errors-invalid-card", invalid, []answer{atTime(Good, start)}},
	}

	var out []goldenCase
	for _, spec := range specs {
		gc := goldenCase{Name: spec.name, Start: toGoldenCard(spec.start)}
		c := spec.start
		prev := start
		if !c.LastReview.IsZero() {
			prev = c.LastReview
		}
		for _, a := range spec.answers {
			at := a.at(c, prev)
			step := goldenStep{At: goldenTime(at), Rating: int(a.rating)}
			step.NextDues = nextDues(c, at)
			next, err := Next(c, a.rating, at)
			if err != nil {
				step.Error = true
			} else {
				g := toGoldenCard(next)
				step.Card = &g
				c, prev = next, at
			}
			gc.Steps = append(gc.Steps, step)
		}
		out = append(out, gc)
	}
	return out
}

// nextDues is when each rating, Again to Easy, would bring c back at now, or
// nil when Next refuses c or now.
func nextDues(c Card, now time.Time) []string {
	var out []string
	for r := Again; r <= Easy; r++ {
		next, err := Next(c, r, now)
		if err != nil {
			return nil
		}
		out = append(out, goldenTime(next.Due))
	}
	return out
}

func TestGolden(t *testing.T) {
	data, err := json.MarshalIndent(goldenFile{Cases: goldenCases(t)}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	if *update {
		if err := os.WriteFile(goldenPath, data, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("%v (run go test ./review -run TestGolden -update)", err)
	}
	if !bytes.Equal(data, want) {
		t.Errorf("Next no longer gives what %s holds; if the change is meant, run go test ./review -run TestGolden -update and check the web's tests", goldenPath)
	}
}
