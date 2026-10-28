package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/chat"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type Questions interface {
	ListQuestions(context.Context, string, int) ([]store.QuestionSummary, error)
	GetQuestion(context.Context, string, string) (store.Question, error)
	PutQuestion(context.Context, string, store.Question, time.Time) (store.Question, error)
}

var _ Questions = (*store.Store)(nil)

type questionSummaryJSON struct {
	ID        string `json:"id"`
	Question  string `json:"question"`
	ModelName string `json:"modelName"`
	CreatedAt string `json:"createdAt"`
}
type questionJSON struct {
	questionSummaryJSON
	Answer string `json:"answer"`
}

func toQuestionSummaryJSON(q store.QuestionSummary) questionSummaryJSON {
	return questionSummaryJSON{q.ID, q.Question, q.ModelName, formatTime(q.CreatedAt)}
}
func toQuestionJSON(q store.Question) questionJSON {
	return questionJSON{toQuestionSummaryJSON(q.QuestionSummary), q.Answer}
}

func listQuestions(qs Questions, model string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows, err := qs.ListQuestions(r.Context(), principalFrom(r.Context()).OwnerID, 100)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := make([]questionSummaryJSON, len(rows))
		for i, q := range rows {
			out[i] = toQuestionSummaryJSON(q)
		}
		writeJSON(w, http.StatusOK, struct {
			ChatModel string                `json:"chatModel"`
			Questions []questionSummaryJSON `json:"questions"`
		}{model, out})
	})
}
func getQuestion(qs Questions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, "質問ノートが見つかりません。")
		if !ok {
			return
		}
		q, err := qs.GetQuestion(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, 404, codeNotFound, "質問ノートが見つかりません。")
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, 200, toQuestionJSON(q))
	})
}
func putQuestion(qs Questions, model string, now func() time.Time) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, "質問ノートが見つかりません。")
		if !ok {
			return
		}
		var req struct {
			Question string `json:"question"`
			Answer   string `json:"answer"`
		}
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		question, answer := strings.TrimSpace(req.Question), strings.TrimSpace(req.Answer)
		if question == "" || answer == "" || utf8.RuneCountInString(question) > 4000 || utf8.RuneCountInString(answer) > chat.MaxAnswerChars {
			writeError(w, 400, codeInvalidRequest, "質問または回答の形式・上限を確認してください。")
			return
		}
		q, err := qs.PutQuestion(r.Context(), principalFrom(r.Context()).OwnerID, store.Question{
			QuestionSummary: store.QuestionSummary{ID: id, Question: question, ModelName: model}, Answer: answer,
		}, now())
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, 404, codeNotFound, "質問ノートが見つからないか、すでに保存されています。")
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, 200, toQuestionJSON(q))
	})
}
