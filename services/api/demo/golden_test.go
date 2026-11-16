package demo

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// The web builds the demo seed itself (src/domain/demo/demo-seed.ts) from its
// copy of the fixture (src/domain/demo/demo-fixture.json). This file pins both
// to the same answers: Go writes what Seed gives for each reset time to the
// golden file (without the random UUIDs), and the web's test
// (tests/demo-seed.test.ts) checks its builder against it.
var updateGolden = flag.Bool("update", false, "rewrite the demo seed golden file the web's tests read")

const (
	goldenPath     = "../../../tests/fixtures/demo-seed-golden.json"
	webFixturePath = "../../../src/domain/demo/demo-fixture.json"
)

type goldenFile struct {
	Cases []goldenCase `json:"cases"`
}

type goldenCase struct {
	Now  string     `json:"now"`
	Seed goldenSeed `json:"seed"`
}

type goldenSeed struct {
	DisplayName        string               `json:"displayName"`
	Notes              []goldenNote         `json:"notes"`
	Words              []goldenWord         `json:"words"`
	Conversations      []goldenConversation `json:"conversations"`
	PrepositionRecords []goldenRound        `json:"prepositionRecords"`
	ComplementRecords  []goldenRound        `json:"complementRecords"`
}

type goldenNote struct {
	Kind          string        `json:"kind"`
	OriginalText  string        `json:"originalText"`
	CorrectedText string        `json:"correctedText"`
	Pinyin        string        `json:"pinyin"`
	Hints         []string      `json:"hints"`
	CreatedAt     string        `json:"createdAt"`
	Review        *goldenReview `json:"review"`
}

type goldenWord struct {
	Word       string       `json:"word"`
	Pinyin     string       `json:"pinyin"`
	Meaning    string       `json:"meaning"`
	SourceNote int          `json:"sourceNote"`
	CreatedAt  string       `json:"createdAt"`
	Review     goldenReview `json:"review"`
}

type goldenReview struct {
	Card    goldenCard     `json:"card"`
	Answers []goldenAnswer `json:"answers"`
}

type goldenAnswer struct {
	Rating int        `json:"rating"`
	At     string     `json:"at"`
	Before goldenCard `json:"before"`
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

type goldenConversation struct {
	Title     string          `json:"title"`
	ModelName string          `json:"modelName"`
	Ended     bool            `json:"ended"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	Messages  []goldenMessage `json:"messages"`
}

type goldenMessage struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

// goldenRound is a practice round; Mode is left out for preposition rounds.
type goldenRound struct {
	Mode      string           `json:"mode,omitempty"`
	ElapsedMs int              `json:"elapsedMs"`
	StartedAt string           `json:"startedAt"`
	CreatedAt string           `json:"createdAt"`
	Questions []goldenQuestion `json:"questions"`
}

type goldenQuestion struct {
	ID     string   `json:"id"`
	Answer string   `json:"answer"`
	Noun   string   `json:"noun"`
	Prompt string   `json:"prompt"`
	Misses []string `json:"misses"`
}

func goldenTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

func toGoldenCard(c review.Card) goldenCard {
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

// toGoldenReview writes no answers as [] rather than null: the store inserts
// nothing for either.
func toGoldenReview(r store.DemoReview) goldenReview {
	out := goldenReview{Card: toGoldenCard(r.Card), Answers: []goldenAnswer{}}
	for _, a := range r.Answers {
		out.Answers = append(out.Answers, goldenAnswer{
			Rating: int(a.Rating), At: goldenTime(a.At), Before: toGoldenCard(a.Before),
		})
	}
	return out
}

func toGoldenRound(r store.PracticeRecordSummary, questions []store.PracticeQuestion) goldenRound {
	out := goldenRound{
		Mode: r.Mode, ElapsedMs: r.ElapsedMs,
		StartedAt: goldenTime(r.StartedAt), CreatedAt: goldenTime(r.CreatedAt),
		Questions: []goldenQuestion{},
	}
	for _, q := range questions {
		out.Questions = append(out.Questions, goldenQuestion{
			ID: q.ID, Answer: q.Answer, Noun: q.Noun, Prompt: q.Prompt, Misses: q.Misses,
		})
	}
	return out
}

func toGoldenSeed(s store.DemoSeed) goldenSeed {
	out := goldenSeed{
		DisplayName:        s.DisplayName,
		Notes:              []goldenNote{},
		Words:              []goldenWord{},
		Conversations:      []goldenConversation{},
		PrepositionRecords: []goldenRound{},
		ComplementRecords:  []goldenRound{},
	}
	for _, n := range s.Notes {
		note := goldenNote{
			Kind: n.Kind, OriginalText: n.OriginalText, CorrectedText: n.CorrectedText,
			Pinyin: n.Pinyin, Hints: n.Hints, CreatedAt: goldenTime(n.CreatedAt),
		}
		if note.Hints == nil {
			note.Hints = []string{}
		}
		if n.Review != nil {
			r := toGoldenReview(*n.Review)
			note.Review = &r
		}
		out.Notes = append(out.Notes, note)
	}
	for _, w := range s.Words {
		out.Words = append(out.Words, goldenWord{
			Word: w.Word, Pinyin: w.Pinyin, Meaning: w.Meaning, SourceNote: w.SourceNote,
			CreatedAt: goldenTime(w.CreatedAt), Review: toGoldenReview(w.Review),
		})
	}
	for _, c := range s.Conversations {
		conv := goldenConversation{
			Title: c.Title, ModelName: c.ModelName, Ended: c.Ended,
			CreatedAt: goldenTime(c.CreatedAt), UpdatedAt: goldenTime(c.UpdatedAt),
			Messages: []goldenMessage{},
		}
		for _, m := range c.Messages {
			conv.Messages = append(conv.Messages, goldenMessage{Role: m.Role, Text: m.Text})
		}
		out.Conversations = append(out.Conversations, conv)
	}
	for _, r := range s.PrepositionRecords {
		out.PrepositionRecords = append(out.PrepositionRecords, toGoldenRound(r.PrepositionRecordSummary, r.Questions))
	}
	for _, r := range s.ComplementRecords {
		out.ComplementRecords = append(out.ComplementRecords, toGoldenRound(r.ComplementRecordSummary, r.Questions))
	}
	return out
}

func TestSeedGolden(t *testing.T) {
	nows := []time.Time{
		// The nightly reset, 04:00 JST.
		time.Date(2026, 11, 10, 19, 0, 0, 0, time.UTC),
		// 00:30 JST: the UTC date is a day behind Japan's.
		time.Date(2026, 11, 10, 15, 30, 0, 0, time.UTC),
	}
	var file goldenFile
	for _, now := range nows {
		seed, err := Seed(now)
		if err != nil {
			t.Fatalf("Seed(%v): %v", now, err)
		}
		file.Cases = append(file.Cases, goldenCase{Now: goldenTime(now), Seed: toGoldenSeed(seed)})
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	if *updateGolden {
		if err := os.WriteFile(goldenPath, data, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("%v (run go test ./demo -run TestSeedGolden -update)", err)
	}
	if !bytes.Equal(data, want) {
		t.Errorf("Seed no longer gives what %s holds; if the change is meant, run go test ./demo -run TestSeedGolden -update and check the web's tests", goldenPath)
	}
}

// The web reads its own copy of the fixture; it must stay the one Go embeds.
func TestWebFixtureIsTheSame(t *testing.T) {
	web, err := os.ReadFile(webFixturePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(web, seedJSON) {
		t.Errorf("%s differs from demo/seed.json; copy seed.json over it", webFixturePath)
	}
}
