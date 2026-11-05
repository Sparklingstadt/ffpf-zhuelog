package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/learning"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// Vocabulary is what the vocabulary handlers need from *store.Store.
type Vocabulary interface {
	ListVocabulary(ctx context.Context, ownerID string, limit int) ([]store.VocabularyEntry, error)
	PutVocabulary(ctx context.Context, ownerID string, e store.VocabularyEntry, now time.Time) (store.VocabularyEntry, error)
	DeleteVocabulary(ctx context.Context, ownerID, id string) error
}

var _ Vocabulary = (*store.Store)(nil)

// VocabularyDrafter suggests a word's pinyin and meaning (OpenAI in main).
type VocabularyDrafter interface {
	DraftVocabulary(ctx context.Context, word, sentence string) (learning.VocabularyDraft, error)
}

var _ VocabularyDrafter = (*learning.OpenAI)(nil)

const (
	vocabularyListLimit = 1000

	maxVocabularyWord     = 20
	maxVocabularyPinyin   = 100
	maxVocabularyMeaning  = 200
	maxVocabularySentence = 300
)

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

// runesWithin is s trimmed, and whether it has min to max characters.
func runesWithin(s string, min, max int) (string, bool) {
	s = strings.TrimSpace(s)
	n := utf8.RuneCountInString(s)
	return s, n >= min && n <= max
}

// listVocabulary returns the owner's words, newest first.
func listVocabulary(vs Vocabulary) http.Handler {
	type response struct {
		Entries []vocabularyJSON `json:"entries"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		list, err := vs.ListVocabulary(r.Context(), principalFrom(r.Context()).OwnerID, vocabularyListLimit)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{Entries: make([]vocabularyJSON, len(list))}
		for i, v := range list {
			out.Entries[i] = toVocabularyJSON(v)
		}
		writeJSON(w, http.StatusOK, out)
	})
}

// putVocabulary adds a word under the id the client made (a UUID), or edits
// the pinyin and the meaning of one already saved under it. A new word goes
// into the review queue.
func putVocabulary(vs Vocabulary, now func() time.Time) http.Handler {
	type request struct {
		Word          string `json:"word"`
		Pinyin        string `json:"pinyin"`
		Meaning       string `json:"meaning"`
		SourceEntryID string `json:"sourceEntryId"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgVocabularyNotFound)
		if !ok {
			return
		}
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		word, okWord := runesWithin(req.Word, 1, maxVocabularyWord)
		pinyin, okPinyin := runesWithin(req.Pinyin, 0, maxVocabularyPinyin)
		meaning, okMeaning := runesWithin(req.Meaning, 1, maxVocabularyMeaning)
		source := strings.TrimSpace(req.SourceEntryID)
		if !okWord || !okPinyin || !okMeaning || (source != "" && !validReviewItemID(source)) {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgVocabularyInvalid)
			return
		}
		saved, err := vs.PutVocabulary(r.Context(), principalFrom(r.Context()).OwnerID, store.VocabularyEntry{
			ID: id, Language: reviewLanguageChinese, Word: word, Pinyin: pinyin, Meaning: meaning, SourceEntryID: source,
		}, now())
		switch {
		case errors.Is(err, store.ErrVocabularyExists):
			writeError(w, http.StatusConflict, codeVocabularyExists, msgVocabularyExists)
		case errors.Is(err, store.ErrNotFound):
			writeError(w, http.StatusNotFound, codeNotFound, msgVocabularyNotFound)
		case err != nil:
			writeServiceError(w, r, err)
		default:
			writeJSON(w, http.StatusOK, toVocabularyJSON(saved))
		}
	})
}

// deleteVocabulary removes a word and its review card.
func deleteVocabulary(vs Vocabulary) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgVocabularyNotFound)
		if !ok {
			return
		}
		err := vs.DeleteVocabulary(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgVocabularyNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// draftVocabulary asks OpenAI for a word's pinyin and meaning. Nothing is
// saved: the owner edits the draft and saves it with PUT.
func draftVocabulary(d VocabularyDrafter) http.Handler {
	type request struct {
		Word     string `json:"word"`
		Sentence string `json:"sentence"`
	}
	type response struct {
		Pinyin  string `json:"pinyin"`
		Meaning string `json:"meaning"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		word, okWord := runesWithin(req.Word, 1, maxVocabularyWord)
		sentence, okSentence := runesWithin(req.Sentence, 0, maxVocabularySentence)
		if !okWord || !okSentence {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgVocabularyInvalid)
			return
		}
		draft, err := d.DraftVocabulary(r.Context(), word, sentence)
		if err != nil {
			var le *learning.Error
			if errors.As(err, &le) {
				loggerFrom(r.Context()).Warn("vocabulary draft failed", "code", le.Code)
			}
			writeError(w, http.StatusBadGateway, codeDraftFailed, msgVocabularyDraft)
			return
		}
		writeJSON(w, http.StatusOK, response{Pinyin: draft.Pinyin, Meaning: draft.Meaning})
	})
}
