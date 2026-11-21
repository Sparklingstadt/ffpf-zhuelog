package httpapi

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/jst"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	testOwner  = "password:owner1"
	otherOwner = "password:abcdefghij0123456789"
)

var authHeader = map[string]string{"Authorization": "Bearer tok"}

func sampleEntry(id string, created time.Time) store.Entry {
	return store.Entry{
		ID:            id,
		Kind:          "correction",
		OriginalText:  "原文",
		CorrectedText: "訂正",
		Pinyin:        "yuan wen",
		Hints:         []store.Hint{{ID: "h-" + id, Content: "ヒント", Position: 0}},
		CreatedAt:     created,
	}
}

type entryView struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"`
	OriginalText  string `json:"originalText"`
	CorrectedText string `json:"correctedText"`
	Pinyin        string `json:"pinyin"`
	Hints         []struct {
		ID       string `json:"id"`
		Content  string `json:"content"`
		Position int    `json:"position"`
	} `json:"hints"`
	CreatedAt string  `json:"createdAt"`
	SharedAt  *string `json:"sharedAt"`
}

// The timeline answers notes in this shape.
func TestEntryJSON(t *testing.T) {
	created := time.Date(2026, 10, 1, 9, 0, 0, 0, jst.Location)
	e := sampleEntry("e0", created)

	b, err := json.Marshal(toEntryJSON(e))
	if err != nil {
		t.Fatal(err)
	}
	var got entryView
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != "e0" || got.Kind != "correction" || got.OriginalText != "原文" || got.CorrectedText != "訂正" ||
		got.Pinyin != "yuan wen" || got.CreatedAt != "2026-10-01T00:00:00.000Z" || got.SharedAt != nil {
		t.Fatalf("got %s", b)
	}
	if len(got.Hints) != 1 || got.Hints[0].ID != "h-e0" || got.Hints[0].Content != "ヒント" || got.Hints[0].Position != 0 {
		t.Fatalf("hints = %+v", got.Hints)
	}

	shared := time.Date(2026, 10, 2, 3, 4, 5, 600_000_000, jst.Location)
	e.SharedAt = &shared
	e.Hints = nil
	b, err = json.Marshal(toEntryJSON(e))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.SharedAt == nil || *got.SharedAt != "2026-10-01T18:04:05.600Z" || got.Hints == nil || len(got.Hints) != 0 {
		t.Fatalf("got %s; want sharedAt in UTC and hints []", b)
	}
}
