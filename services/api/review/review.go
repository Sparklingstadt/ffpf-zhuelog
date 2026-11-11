// Package review schedules spaced-repetition reviews with FSRS
// (github.com/open-spaced-repetition/go-fsrs). It knows nothing about what is
// reviewed: the store keeps a Card per item and passes it here with each
// answer.
package review

import (
	"fmt"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v4"
)

// Rating is how well an item was recalled, as the four answer buttons give it.
type Rating int

const (
	Again Rating = 1 // もう一度
	Hard  Rating = 2 // 難しい
	Good  Rating = 3 // できた
	Easy  Rating = 4 // 簡単
)

// Valid reports whether r is one of the four ratings.
func (r Rating) Valid() bool { return r >= Again && r <= Easy }

// State is where a card is in FSRS's cycle.
type State int

const (
	New        State = 0
	Learning   State = 1
	Reviewing  State = 2
	Relearning State = 3
)

// Card is an item's FSRS memory state and when it is next due. LastReview is
// the zero time until the first answer.
type Card struct {
	Due            time.Time
	Stability      float64
	Difficulty     float64
	ScheduledDays  int
	Reps           int
	Lapses         int
	State          State
	RemainingSteps int
	LastReview     time.Time
}

// NewCard is a card that has never been reviewed, due at now.
func NewCard(now time.Time) Card {
	return Card{Due: now, State: New}
}

// scheduler uses FSRS's default parameters (90% retention, learning steps of
// 1 and 10 minutes, no fuzz) until there is enough history to fit them.
var scheduler = fsrs.NewFSRS(fsrs.DefaultParam())

// Next is c after an answer rated r at now.
func Next(c Card, r Rating, now time.Time) (Card, error) {
	if !r.Valid() {
		return Card{}, fmt.Errorf("review: invalid rating %d", r)
	}
	info, err := scheduler.Next(toFSRS(c), now, fsrs.Rating(r))
	if err != nil {
		return Card{}, fmt.Errorf("review: %w", err)
	}
	return fromFSRS(info.Card), nil
}

// NextDues is when c would next be due after each answer at now, indexed by
// rating minus one (もう一度, 難しい, できた, 簡単), so the buttons can say
// how long each puts the item off.
func NextDues(c Card, now time.Time) ([4]time.Time, error) {
	var out [4]time.Time
	for r := Again; r <= Easy; r++ {
		next, err := Next(c, r, now)
		if err != nil {
			return out, err
		}
		out[r-1] = next.Due
	}
	return out, nil
}

func toFSRS(c Card) fsrs.Card {
	return fsrs.Card{
		Due:            c.Due,
		Stability:      c.Stability,
		Difficulty:     c.Difficulty,
		ScheduledDays:  uint64(max(c.ScheduledDays, 0)),
		Reps:           uint64(max(c.Reps, 0)),
		Lapses:         uint64(max(c.Lapses, 0)),
		State:          fsrs.State(c.State),
		LastReview:     c.LastReview,
		RemainingSteps: c.RemainingSteps,
	}
}

func fromFSRS(c fsrs.Card) Card {
	return Card{
		Due:            c.Due,
		Stability:      c.Stability,
		Difficulty:     c.Difficulty,
		ScheduledDays:  int(c.ScheduledDays),
		Reps:           int(c.Reps),
		Lapses:         int(c.Lapses),
		State:          State(c.State),
		RemainingSteps: c.RemainingSteps,
		LastReview:     c.LastReview,
	}
}
