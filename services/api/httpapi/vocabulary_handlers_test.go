package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/learning"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type fakeVocabulary struct {
	list    []store.VocabularyEntry
	put     store.VocabularyEntry
	putErr  error
	deleted string
	delErr  error
	owner   string
	now     time.Time
}

func (f *fakeVocabulary) ListVocabulary(_ context.Context, ownerID string, limit int) ([]store.VocabularyEntry, error) {
	f.owner = ownerID
	return f.list, nil
}

func (f *fakeVocabulary) PutVocabulary(_ context.Context, ownerID string, e store.VocabularyEntry, now time.Time) (store.VocabularyEntry, error) {
	f.owner, f.put, f.now = ownerID, e, now
	if f.putErr != nil {
		return store.VocabularyEntry{}, f.putErr
	}
	e.CreatedAt, e.UpdatedAt = now, now
	return e, nil
}

func (f *fakeVocabulary) DeleteVocabulary(_ context.Context, ownerID, id string) error {
	f.owner, f.deleted = ownerID, id
	return f.delErr
}

type fakeDrafter struct {
	word, sentence string
	err            error
}

func (f *fakeDrafter) DraftVocabulary(_ context.Context, word, sentence string) (learning.VocabularyDraft, error) {
	f.word, f.sentence = word, sentence
	if f.err != nil {
		return learning.VocabularyDraft{}, f.err
	}
	return learning.VocabularyDraft{Pinyin: "rènzhēn", Meaning: "まじめに"}, nil
}

func TestVocabularyRoutesRejectGuests(t *testing.T) {
	h, _ := reviewRouter(t, auth.RoleGuest, Deps{Vocabulary: &fakeVocabulary{}, VocabularyDrafter: &fakeDrafter{}})
	for _, rt := range []struct{ method, path, body string }{
		{"GET", "/v1/vocabulary", ""},
		{"PUT", "/v1/vocabulary/" + testConversationID, `{"word":"认真","meaning":"まじめに"}`},
		{"DELETE", "/v1/vocabulary/" + testConversationID, ""},
		{"POST", "/v1/vocabulary/draft", `{"word":"认真"}`},
	} {
		wantError(t, do(h, rt.method, rt.path, rt.body, jsonAuth), http.StatusForbidden, "forbidden")
	}
}

func TestPutVocabulary(t *testing.T) {
	vs := &fakeVocabulary{}
	h, clk := reviewRouter(t, auth.RoleMember, Deps{Vocabulary: vs})
	path := "/v1/vocabulary/" + testConversationID

	w := do(h, "PUT", path, `{"word":" 认真 ","pinyin":"rènzhēn","meaning":"まじめに","sourceEntryId":"`+testReviewItemID+`"}`, jsonAuth)
	var got map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || vs.owner != testOwner || !vs.now.Equal(clk.Now()) ||
		vs.put != (store.VocabularyEntry{ID: testConversationID, Language: "zh", Word: "认真", Pinyin: "rènzhēn", Meaning: "まじめに", SourceEntryID: testReviewItemID}) ||
		got["word"] != "认真" || got["sourceEntryId"] != testReviewItemID {
		t.Fatalf("put = %d %s (%+v)", w.Code, w.Body.String(), vs.put)
	}
	if w := do(h, "PUT", path, `{"word":"认真","meaning":"まじめに"}`, jsonAuth); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"sourceEntryId":null`) {
		t.Errorf("without pinyin and source = %d %s", w.Code, w.Body.String())
	}

	for name, body := range map[string]string{
		"no word":     `{"word":" ","meaning":"x"}`,
		"long word":   `{"word":"` + strings.Repeat("字", maxVocabularyWord+1) + `","meaning":"x"}`,
		"no meaning":  `{"word":"认真","meaning":""}`,
		"long pinyin": `{"word":"认真","meaning":"x","pinyin":"` + strings.Repeat("a", maxVocabularyPinyin+1) + `"}`,
		"bad source":  `{"word":"认真","meaning":"x","sourceEntryId":"../x"}`,
		"not JSON":    `{`,
	} {
		t.Run(name, func(t *testing.T) {
			wantError(t, do(h, "PUT", path, body, jsonAuth), http.StatusBadRequest, "invalid_request")
		})
	}
	wantError(t, do(h, "PUT", "/v1/vocabulary/not-a-uuid", `{"word":"认真","meaning":"x"}`, jsonAuth), http.StatusNotFound, "not_found")

	vs.putErr = store.ErrVocabularyExists
	wantError(t, do(h, "PUT", path, `{"word":"认真","meaning":"x"}`, jsonAuth), http.StatusConflict, "vocabulary_exists")
	vs.putErr = store.ErrNotFound
	wantError(t, do(h, "PUT", path, `{"word":"认真","meaning":"x"}`, jsonAuth), http.StatusNotFound, "not_found")
}

func TestListAndDeleteVocabulary(t *testing.T) {
	at := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	vs := &fakeVocabulary{list: []store.VocabularyEntry{{ID: testConversationID, Language: "zh", Word: "认真", Meaning: "まじめに", CreatedAt: at, UpdatedAt: at}}}
	h, _ := reviewRouter(t, auth.RoleMember, Deps{Vocabulary: vs})

	w := do(h, "GET", "/v1/vocabulary", "", jsonAuth)
	var got struct {
		Entries []map[string]any `json:"entries"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || len(got.Entries) != 1 || got.Entries[0]["word"] != "认真" ||
		got.Entries[0]["createdAt"] != "2026-11-05T12:00:00.000Z" || got.Entries[0]["sourceEntryId"] != nil {
		t.Fatalf("list = %d %s", w.Code, w.Body.String())
	}

	if w := do(h, "DELETE", "/v1/vocabulary/"+testConversationID, "", jsonAuth); w.Code != http.StatusNoContent || vs.deleted != testConversationID {
		t.Fatalf("delete = %d %s", w.Code, w.Body.String())
	}
	vs.delErr = store.ErrNotFound
	wantError(t, do(h, "DELETE", "/v1/vocabulary/"+testConversationID, "", jsonAuth), http.StatusNotFound, "not_found")
}

func TestDraftVocabulary(t *testing.T) {
	d := &fakeDrafter{}
	h, _ := reviewRouter(t, auth.RoleMember, Deps{Vocabulary: &fakeVocabulary{}, VocabularyDrafter: d})

	w := do(h, "POST", "/v1/vocabulary/draft", `{"word":"认真","sentence":"他学习很认真。"}`, jsonAuth)
	if w.Code != http.StatusOK || d.word != "认真" || d.sentence != "他学习很认真。" ||
		!strings.Contains(w.Body.String(), `"pinyin":"rènzhēn"`) || !strings.Contains(w.Body.String(), `"meaning":"まじめに"`) {
		t.Fatalf("draft = %d %s", w.Code, w.Body.String())
	}
	wantError(t, do(h, "POST", "/v1/vocabulary/draft", `{"word":""}`, jsonAuth), http.StatusBadRequest, "invalid_request")
	wantError(t, do(h, "POST", "/v1/vocabulary/draft", `{"word":"认真","sentence":"`+strings.Repeat("字", maxVocabularySentence+1)+`"}`, jsonAuth),
		http.StatusBadRequest, "invalid_request")

	d.err = &learning.Error{Code: "OPENAI_TIMEOUT", Retryable: true}
	wantError(t, do(h, "POST", "/v1/vocabulary/draft", `{"word":"认真"}`, jsonAuth), http.StatusBadGateway, "draft_failed")
}

func TestDraftNeedsOpenAI(t *testing.T) {
	h, _ := reviewRouter(t, auth.RoleMember, Deps{Vocabulary: &fakeVocabulary{}})
	if w := do(h, "POST", "/v1/vocabulary/draft", `{"word":"认真"}`, jsonAuth); w.Code == http.StatusOK || w.Code == http.StatusBadGateway {
		t.Errorf("draft without OpenAI = %d", w.Code)
	}
}

func TestDueVocabularyItemsCarryTheirWord(t *testing.T) {
	v := store.VocabularyEntry{ID: testConversationID, Language: "zh", Word: "认真", Pinyin: "rènzhēn", Meaning: "まじめに"}
	rv := &fakeReviews{count: 1, due: []store.ReviewItem{{
		ID: testReviewItemID, ReviewTarget: store.ReviewTarget{Language: "zh", Kind: "vocabulary", TargetID: v.ID},
		Card: review.Card{Due: time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)}, Vocabulary: &v,
	}}}
	h, _ := reviewRouter(t, auth.RoleMember, Deps{Reviews: rv})
	w := do(h, "GET", "/v1/reviews/due", "", jsonAuth)
	var got struct {
		Items []struct {
			Vocabulary *struct {
				Word, Pinyin, Meaning string
			} `json:"vocabulary"`
		} `json:"items"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || len(got.Items) != 1 || got.Items[0].Vocabulary == nil ||
		got.Items[0].Vocabulary.Word != "认真" || got.Items[0].Vocabulary.Meaning != "まじめに" {
		t.Fatalf("due = %d %s", w.Code, w.Body.String())
	}
}
