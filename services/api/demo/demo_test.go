package demo

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// The nightly reset runs at 04:00 JST (19:00 UTC).
var resetTime = time.Date(2026, 11, 10, 19, 0, 0, 0, time.UTC)

func TestSeedIsRecentAndComplete(t *testing.T) {
	seed, err := Seed(resetTime)
	if err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if seed.DisplayName == "" {
		t.Error("no display name")
	}
	if n := len(seed.Notes); n < 10 || n > 15 {
		t.Errorf("%d notes, want about 12", n)
	}
	if n := len(seed.Words); n < 8 || n > 12 {
		t.Errorf("%d words, want about 10", n)
	}
	if len(seed.Conversations) != 2 {
		t.Errorf("%d conversations, want 2", len(seed.Conversations))
	}
	if len(seed.PrepositionRecords) == 0 || len(seed.ComplementRecords) == 0 {
		t.Error("no practice records")
	}

	oldest := resetTime.Add(-8 * 24 * time.Hour)
	recent := func(what string, at time.Time) {
		t.Helper()
		if !at.Before(resetTime) || at.Before(oldest) {
			t.Errorf("%s at %v, want within the 7 days before %v", what, at, resetTime)
		}
	}
	due, inReview := 0, 0
	for _, n := range seed.Notes {
		recent("note "+n.OriginalText, n.CreatedAt)
		if n.Kind != "correction" && n.Kind != "translation" {
			t.Errorf("note %q has kind %q", n.OriginalText, n.Kind)
		}
		if n.CorrectedText == "" || n.Pinyin == "" || len(n.Hints) == 0 {
			t.Errorf("note %q is missing a field", n.OriginalText)
		}
		if n.Review != nil {
			inReview++
			if !n.Review.Card.Due.After(resetTime) {
				due++
			}
		}
	}
	if inReview < 2 {
		t.Errorf("%d notes in review, want a couple", inReview)
	}
	for _, w := range seed.Words {
		recent("word "+w.Word, w.CreatedAt)
		if !uuidPattern.MatchString(w.ID) {
			t.Errorf("word id %q is not a UUID", w.ID)
		}
		if w.SourceNote < 0 || w.SourceNote >= len(seed.Notes) {
			t.Errorf("word %q names note %d", w.Word, w.SourceNote)
		}
		if !w.Review.Card.Due.After(resetTime) {
			due++
		}
		for i, a := range w.Review.Answers {
			recent("answer to "+w.Word, a.At)
			if a.At.Before(w.CreatedAt) {
				t.Errorf("word %q answered before it was added", w.Word)
			}
			if i > 0 && !a.At.After(w.Review.Answers[i-1].At) {
				t.Errorf("word %q: answers out of order", w.Word)
			}
		}
	}
	if due < 3 {
		t.Errorf("%d reviews due at the reset, want today's reviews to have something", due)
	}
	for _, c := range seed.Conversations {
		recent("conversation "+c.Title, c.CreatedAt)
		if !uuidPattern.MatchString(c.ID) || len(c.Messages) < 2 {
			t.Errorf("conversation %q: id %q, %d messages", c.Title, c.ID, len(c.Messages))
		}
	}
	for _, r := range seed.PrepositionRecords {
		recent("preposition round", r.StartedAt)
		if !r.CreatedAt.After(r.StartedAt) || len(r.Questions) == 0 {
			t.Errorf("preposition round %+v", r.PrepositionRecordSummary)
		}
	}
}

func TestSeedFollowsTheResetDay(t *testing.T) {
	a, err := Seed(resetTime)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Seed(resetTime.Add(24 * time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if got := b.Notes[0].CreatedAt.Sub(a.Notes[0].CreatedAt); got != 24*time.Hour {
		t.Errorf("a day later the first note moved by %v, want 24h", got)
	}
	if a.Words[0].ID == b.Words[0].ID {
		t.Error("ids are reused between resets")
	}
}

type fakeStore struct {
	loginID string
	seed    store.DemoSeed
	now     time.Time
}

func (f *fakeStore) ResetDemo(_ context.Context, loginID string, seed store.DemoSeed, now time.Time) (string, error) {
	f.loginID, f.seed, f.now = loginID, seed, now
	return "cdemo", nil
}

func TestResetterPassesTheSeed(t *testing.T) {
	f := &fakeStore{}
	r := &Resetter{Store: f, LoginID: "demo"}
	if err := r.Reset(context.Background(), resetTime); err != nil {
		t.Fatalf("Reset: %v", err)
	}
	if f.loginID != "demo" || !f.now.Equal(resetTime) || len(f.seed.Notes) == 0 {
		t.Fatalf("ResetDemo got %q, %v, %d notes", f.loginID, f.now, len(f.seed.Notes))
	}
}
