package httpapi

import "github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"

// vocabularyJSON is a vocabulary word as a review item carries it. The web
// owns the vocabulary book itself.
type vocabularyJSON struct {
	ID            string  `json:"id"`
	Language      string  `json:"language"`
	Word          string  `json:"word"`
	Pinyin        string  `json:"pinyin"`
	Meaning       string  `json:"meaning"`
	SourceEntryID *string `json:"sourceEntryId"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedAt     string  `json:"updatedAt"`
}

func toVocabularyJSON(v store.VocabularyEntry) vocabularyJSON {
	out := vocabularyJSON{
		ID: v.ID, Language: v.Language, Word: v.Word, Pinyin: v.Pinyin, Meaning: v.Meaning,
		CreatedAt: formatTime(v.CreatedAt), UpdatedAt: formatTime(v.UpdatedAt),
	}
	if v.SourceEntryID != "" {
		source := v.SourceEntryID
		out.SourceEntryID = &source
	}
	return out
}
