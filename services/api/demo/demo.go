// Package demo builds the demo account's data from an embedded fixture and
// resets the account to it. The fixture's dates are days before the reset,
// in Japan time, so the demo always looks recent.
package demo

import (
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

//go:embed seed.json
var seedJSON []byte

var jst = time.FixedZone("JST", 9*3600)

// Store is the part of *store.Store a Resetter needs.
type Store interface {
	ResetDemo(ctx context.Context, loginID string, seed store.DemoSeed, now time.Time) (string, error)
}

// Resetter puts the demo account LoginID back to the fixture.
type Resetter struct {
	Store   Store
	LoginID string
}

// Reset makes the account if it is missing and replaces its data with the
// fixture, dated relative to now.
func (r *Resetter) Reset(ctx context.Context, now time.Time) error {
	seed, err := Seed(now)
	if err != nil {
		return err
	}
	if _, err := r.Store.ResetDemo(ctx, r.LoginID, seed, now); err != nil {
		return err
	}
	return nil
}

type fixture struct {
	DisplayName        string          `json:"displayName"`
	Notes              []fixtureNote   `json:"notes"`
	Words              []fixtureWord   `json:"words"`
	Conversations      []fixtureChat   `json:"conversations"`
	PrepositionRecords []fixtureRecord `json:"prepositionRecords"`
	ComplementRecords  []fixtureRecord `json:"complementRecords"`
}

// fixtureTime is "day" days before the reset at "time" (HH:MM, Japan time).
type fixtureTime struct {
	Day  int    `json:"day"`
	Time string `json:"time"`
}

type fixtureNote struct {
	fixtureTime
	Kind      string         `json:"kind"`
	Original  string         `json:"original"`
	Corrected string         `json:"corrected"`
	Pinyin    string         `json:"pinyin"`
	Hints     []string       `json:"hints"`
	Review    *fixtureReview `json:"review"`
}

// fixtureReview lists the answers given so far. Due is "today" (due now) or
// "later" (due after the reset).
type fixtureReview struct {
	Answers []fixtureAnswer `json:"answers"`
	Due     string          `json:"due"`
}

type fixtureAnswer struct {
	fixtureTime
	Rating int `json:"rating"`
}

// fixtureWord is picked from note Note (an index in notes) a few minutes
// after it was written. Without a review it is a new card, due now.
type fixtureWord struct {
	Word    string         `json:"word"`
	Pinyin  string         `json:"pinyin"`
	Meaning string         `json:"meaning"`
	Note    int            `json:"note"`
	Review  *fixtureReview `json:"review"`
}

type fixtureChat struct {
	fixtureTime
	Title    string `json:"title"`
	Model    string `json:"model"`
	Messages []struct {
		Role string `json:"role"`
		Text string `json:"text"`
	} `json:"messages"`
}

type fixtureRecord struct {
	fixtureTime
	Mode           string `json:"mode"`
	ElapsedSeconds int    `json:"elapsedSeconds"`
	Questions      []struct {
		ID     string   `json:"id"`
		Answer string   `json:"answer"`
		Noun   string   `json:"noun"`
		Prompt string   `json:"prompt"`
		Misses []string `json:"misses"`
	} `json:"questions"`
}

// wordDelay is how long after its note a word is picked.
const wordDelay = 5 * time.Minute

// Seed is the fixture with its dates made relative to now.
func Seed(now time.Time) (store.DemoSeed, error) {
	var f fixture
	dec := json.NewDecoder(bytes.NewReader(seedJSON))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return store.DemoSeed{}, fmt.Errorf("demo: read fixture: %w", err)
	}
	b := builder{now: now}
	seed := store.DemoSeed{DisplayName: f.DisplayName}

	for _, n := range f.Notes {
		created := b.at(n.fixtureTime)
		note := store.DemoNote{
			EntryDraft: store.EntryDraft{
				Kind: n.Kind, OriginalText: n.Original, CorrectedText: n.Corrected, Pinyin: n.Pinyin, Hints: n.Hints,
			},
			CreatedAt: created,
		}
		if n.Review != nil {
			r := b.review(created, *n.Review)
			note.Review = &r
		}
		seed.Notes = append(seed.Notes, note)
	}
	for _, w := range f.Words {
		if w.Note < 0 || w.Note >= len(seed.Notes) {
			b.fail(fmt.Errorf("word %q names note %d", w.Word, w.Note))
			continue
		}
		created := seed.Notes[w.Note].CreatedAt.Add(wordDelay)
		r := store.DemoReview{Card: review.NewCard(created)}
		if w.Review != nil {
			r = b.review(created, *w.Review)
		}
		seed.Words = append(seed.Words, store.DemoWord{
			ID: newUUID(), Word: w.Word, Pinyin: w.Pinyin, Meaning: w.Meaning,
			SourceNote: w.Note, CreatedAt: created, Review: r,
		})
	}
	for _, c := range f.Conversations {
		started := b.at(c.fixtureTime)
		conv := store.Conversation{ConversationSummary: store.ConversationSummary{
			ID: newUUID(), Title: c.Title, ModelName: c.Model, Ended: true,
			CreatedAt: started,
			// About a minute per message.
			UpdatedAt: started.Add(time.Duration(len(c.Messages)) * time.Minute),
		}}
		for _, m := range c.Messages {
			conv.Messages = append(conv.Messages, store.ConversationMessage{ID: newUUID(), Role: m.Role, Text: m.Text})
		}
		seed.Conversations = append(seed.Conversations, conv)
	}
	for _, r := range f.PrepositionRecords {
		started, finished := b.round(r)
		rec := store.PrepositionRecord{PrepositionRecordSummary: store.PrepositionRecordSummary{
			ID: newUUID(), ElapsedMs: r.ElapsedSeconds * 1000, StartedAt: started, CreatedAt: finished,
		}}
		for _, q := range r.Questions {
			rec.Questions = append(rec.Questions, store.PrepositionQuestion{
				ID: q.ID, Answer: q.Answer, Noun: q.Noun, Prompt: q.Prompt, Misses: nonNil(q.Misses),
			})
		}
		seed.PrepositionRecords = append(seed.PrepositionRecords, rec)
	}
	for _, r := range f.ComplementRecords {
		started, finished := b.round(r)
		rec := store.ComplementRecord{ComplementRecordSummary: store.ComplementRecordSummary{
			ID: newUUID(), Mode: r.Mode, ElapsedMs: r.ElapsedSeconds * 1000, StartedAt: started, CreatedAt: finished,
		}}
		for _, q := range r.Questions {
			rec.Questions = append(rec.Questions, store.ComplementQuestion{
				ID: q.ID, Answer: q.Answer, Noun: q.Noun, Prompt: q.Prompt, Misses: nonNil(q.Misses),
			})
		}
		seed.ComplementRecords = append(seed.ComplementRecords, rec)
	}
	if b.err != nil {
		return store.DemoSeed{}, fmt.Errorf("demo: fixture: %w", b.err)
	}
	return seed, nil
}

// builder turns fixture times into times before now and keeps the first
// error, so Seed reads straight through.
type builder struct {
	now time.Time
	err error
}

func (b *builder) fail(err error) {
	if b.err == nil {
		b.err = err
	}
}

// at is t's day and time in Japan time. A time later than now (a note of
// today, reset early in the morning) moves to a minute before now.
func (b *builder) at(t fixtureTime) time.Time {
	clock, err := time.Parse("15:04", t.Time)
	if err != nil || t.Day < 0 {
		b.fail(fmt.Errorf("bad time %d %q", t.Day, t.Time))
		return b.now
	}
	today := b.now.In(jst)
	day := time.Date(today.Year(), today.Month(), today.Day()-t.Day, clock.Hour(), clock.Minute(), 0, 0, jst)
	if day.After(b.now) {
		return b.now.Add(-time.Minute)
	}
	return day
}

// round is when a practice round started and was saved.
func (b *builder) round(r fixtureRecord) (time.Time, time.Time) {
	started := b.at(r.fixtureTime)
	return started, started.Add(time.Duration(r.ElapsedSeconds) * time.Second)
}

// review answers a new card made at created as the fixture says, with FSRS,
// and then moves its due date: to an hour before now for "today", or past
// now for "later" when FSRS has it due already.
func (b *builder) review(created time.Time, f fixtureReview) store.DemoReview {
	card := review.NewCard(created)
	var answers []store.DemoAnswer
	for _, a := range f.Answers {
		at := b.at(a.fixtureTime)
		rating := review.Rating(a.Rating)
		// Answers come after the card is made, one after another.
		if !rating.Valid() || at.Before(created) || (!card.LastReview.IsZero() && !at.After(card.LastReview)) {
			b.fail(fmt.Errorf("bad answer %+v", a))
			continue
		}
		next, err := review.Next(card, rating, at)
		if err != nil {
			b.fail(err)
			continue
		}
		answers = append(answers, store.DemoAnswer{Rating: rating, At: at, Before: card})
		card = next
	}
	switch f.Due {
	case "today":
		card.Due = b.now.Add(-time.Hour)
	case "later":
		if !card.Due.After(b.now) {
			card.Due = b.now.Add(48 * time.Hour)
		}
	default:
		b.fail(fmt.Errorf("bad due %q", f.Due))
	}
	return store.DemoReview{Card: card, Answers: answers}
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// newUUID is a random (version 4) UUID, as the browser makes them for the
// rows it saves.
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
