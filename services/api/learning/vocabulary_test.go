package learning

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDraftVocabularySendsTheWordAndSentenceAsData(t *testing.T) {
	var gotReq map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotReq)
		_, _ = io.WriteString(w, outputBody(t, `{"pinyin":" rènzhēn ","meaning":"まじめに、真剣に"}`))
	}))
	defer srv.Close()
	o := &OpenAI{HTTP: srv.Client(), BaseURL: srv.URL, APIKey: testKey}

	d, err := o.DraftVocabulary(context.Background(), "认真", "他学习很认真。")
	if err != nil {
		t.Fatal(err)
	}
	if d.Pinyin != "rènzhēn" || d.Meaning != "まじめに、真剣に" {
		t.Errorf("draft = %+v", d)
	}
	var input map[string]string
	if s, _ := gotReq["input"].(string); json.Unmarshal([]byte(s), &input) != nil ||
		input["word"] != "认真" || input["sentence"] != "他学习很认真。" {
		t.Errorf("input = %v", gotReq["input"])
	}
	format, _ := gotReq["text"].(map[string]any)["format"].(map[string]any)
	if gotReq["model"] != model || format["name"] != "vocabulary_card_draft" || format["strict"] != true {
		t.Errorf("request = %v", gotReq)
	}
}

func TestDraftVocabularyRejectsBadOutput(t *testing.T) {
	for name, inner := range map[string]string{
		"not JSON":      `{`,
		"empty meaning": `{"pinyin":"rènzhēn","meaning":"  "}`,
		"extra key":     `{"pinyin":"rènzhēn","meaning":"まじめに","hints":[]}`,
		"missing key":   `{"pinyin":"rènzhēn"}`,
		"long pinyin":   `{"pinyin":"` + strings.Repeat("a", maxDraftPinyinRunes+1) + `","meaning":"x"}`,
	} {
		t.Run(name, func(t *testing.T) {
			o, _ := serve(t, http.StatusOK, outputBody(t, inner))
			_, err := o.DraftVocabulary(context.Background(), "认真", "")
			var le *Error
			if !errors.As(err, &le) || le.Code != "OPENAI_INVALID_RESPONSE" {
				t.Errorf("err = %v", err)
			}
		})
	}
	o, _ := serve(t, http.StatusUnauthorized, `{}`)
	_, err := o.DraftVocabulary(context.Background(), "认真", "")
	var le *Error
	if !errors.As(err, &le) || le.Code != "OPENAI_AUTH_FAILED" {
		t.Errorf("401 err = %v", err)
	}
}
