package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/chat"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// ChatStreamer is what the chat handler needs from *chat.Streamer.
type ChatStreamer interface {
	Stream(ctx context.Context, msgs []chat.Message, emit func(text string) error) error
}

// Conversations is what the conversation handlers need from *store.Store.
type Conversations interface {
	ListConversations(ctx context.Context, ownerID string, limit int) ([]store.ConversationSummary, error)
	GetConversation(ctx context.Context, ownerID, id string) (store.Conversation, error)
	PutConversation(ctx context.Context, ownerID string, c store.Conversation, now time.Time) (store.Conversation, error)
	DeleteConversation(ctx context.Context, ownerID, id string) error
}

var (
	_ ChatStreamer  = (*chat.Streamer)(nil)
	_ Conversations = (*store.Store)(nil)
)

const (
	// chatBodyLimit caps POST /v1/chat bodies, below the 1 MiB of limitBody.
	chatBodyLimit = 256 << 10
	// chatWriteTimeout is how long one answer may stream. It is longer than
	// the server's 30 s WriteTimeout and the 60 s OpenAI limit.
	chatWriteTimeout = 90 * time.Second
	// conversationListLimit is how many conversations the list returns.
	conversationListLimit = 100

	maxConversationTitle     = 100
	maxConversationModelName = 150
	maxConversationMessageID = 200
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func validConversationID(s string) bool { return uuidPattern.MatchString(s) }

// chatLine is one line of the NDJSON answer: "delta" with the next piece of
// text, then "done", or "error" with a message once text has been sent.
type chatLine struct {
	Type    string `json:"type"`
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
}

// extendChatDeadlines gives one chat request a write deadline long enough for
// a whole answer, like extendLineDeadlines.
func extendChatDeadlines(w http.ResponseWriter) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(chatWriteTimeout))
}

// streamChat continues the conversation with ChatGPT and streams the answer
// as NDJSON, flushing every line. A failure before anything is written is a
// 502; after that it is an "error" line. Only the failure code is logged,
// never the messages.
func streamChat(c ChatStreamer) http.Handler {
	type request struct {
		Messages []chat.Message `json:"messages"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, chatBodyLimit)
		var req request
		if err := decodeBody(r, &req); err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				writeBodyError(w, r, err)
				return
			}
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgChatInvalid)
			return
		}
		if chat.Validate(req.Messages) != nil {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgChatInvalid)
			return
		}
		extendChatDeadlines(w)

		rc := http.NewResponseController(w)
		started := false
		writeLine := func(line chatLine) error {
			b, err := json.Marshal(line)
			if err != nil {
				return err
			}
			if !started {
				w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
				// Asks proxies not to hold the answer back.
				w.Header().Set("X-Accel-Buffering", "no")
				w.WriteHeader(http.StatusOK)
				started = true
			}
			if _, err := w.Write(append(b, '\n')); err != nil {
				return err
			}
			if err := rc.Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
				return err
			}
			return nil
		}

		err := c.Stream(r.Context(), req.Messages, func(text string) error {
			return writeLine(chatLine{Type: "delta", Text: text})
		})
		if err == nil {
			_ = writeLine(chatLine{Type: "done"})
			return
		}
		var chatErr *chat.Error
		if errors.As(err, &chatErr) {
			loggerFrom(r.Context()).Warn("chat failed", "code", chatErr.Code)
		} else {
			loggerFrom(r.Context()).Info("chat stream stopped")
		}
		if !started {
			writeError(w, http.StatusBadGateway, codeChatFailed, msgChatFailed)
			return
		}
		_ = writeLine(chatLine{Type: "error", Message: msgChatFailed})
	})
}

type conversationSummaryJSON struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	ModelName string `json:"modelName"`
	Ended     bool   `json:"ended"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type conversationJSON struct {
	conversationSummaryJSON
	Messages []store.ConversationMessage `json:"messages"`
}

func toConversationSummaryJSON(c store.ConversationSummary) conversationSummaryJSON {
	return conversationSummaryJSON{
		ID: c.ID, Title: c.Title, ModelName: c.ModelName, Ended: c.Ended,
		CreatedAt: formatTime(c.CreatedAt), UpdatedAt: formatTime(c.UpdatedAt),
	}
}

func toConversationJSON(c store.Conversation) conversationJSON {
	return conversationJSON{conversationSummaryJSON: toConversationSummaryJSON(c.ConversationSummary), Messages: c.Messages}
}

func listConversations(cs Conversations, chatModel string) http.Handler {
	type response struct {
		ChatModel     string                    `json:"chatModel"`
		Conversations []conversationSummaryJSON `json:"conversations"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		list, err := cs.ListConversations(r.Context(), principalFrom(r.Context()).OwnerID, conversationListLimit)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{ChatModel: chatModel, Conversations: make([]conversationSummaryJSON, len(list))}
		for i, c := range list {
			out.Conversations[i] = toConversationSummaryJSON(c)
		}
		writeJSON(w, http.StatusOK, out)
	})
}

func getConversation(cs Conversations) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgConversationNotFound)
		if !ok {
			return
		}
		c, err := cs.GetConversation(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgConversationNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toConversationJSON(c))
	})
}

// putConversation saves the whole conversation the browser sends after each
// answer. The id in the path names it; updatedAt is the server's time.
func putConversation(cs Conversations, now func() time.Time) http.Handler {
	type request struct {
		Title     string                      `json:"title"`
		ModelName string                      `json:"modelName"`
		Ended     bool                        `json:"ended"`
		CreatedAt string                      `json:"createdAt"`
		Messages  []store.ConversationMessage `json:"messages"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgConversationNotFound)
		if !ok {
			return
		}
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		createdAt, err := time.Parse(time.RFC3339Nano, req.CreatedAt)
		if err != nil || !validConversation(req.Title, req.ModelName, req.Messages) {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgChatInvalid)
			return
		}
		saved, err := cs.PutConversation(r.Context(), principalFrom(r.Context()).OwnerID, store.Conversation{
			ConversationSummary: store.ConversationSummary{
				ID: id, Title: strings.TrimSpace(req.Title), ModelName: req.ModelName,
				Ended: req.Ended, CreatedAt: createdAt,
			},
			Messages: req.Messages,
		}, now())
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgConversationNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toConversationJSON(saved))
	})
}

// validConversation applies the limits of chat.Validate to a saved
// conversation, which may end with either role (a finished one ends with the
// answer).
func validConversation(title, modelName string, msgs []store.ConversationMessage) bool {
	if n := utf8.RuneCountInString(strings.TrimSpace(title)); n == 0 || n > maxConversationTitle {
		return false
	}
	if modelName == "" || utf8.RuneCountInString(modelName) > maxConversationModelName {
		return false
	}
	if len(msgs) == 0 || len(msgs) > chat.MaxMessages {
		return false
	}
	seen := make(map[string]bool, len(msgs))
	total := 0
	for _, m := range msgs {
		if m.ID == "" || utf8.RuneCountInString(m.ID) > maxConversationMessageID || seen[m.ID] {
			return false
		}
		seen[m.ID] = true
		if (m.Role != "user" && m.Role != "assistant") || strings.TrimSpace(m.Text) == "" {
			return false
		}
		total += utf8.RuneCountInString(m.Text)
	}
	return total <= chat.MaxTotalChars
}

func deleteConversation(cs Conversations) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValueMsg(w, r, "id", validConversationID, msgConversationNotFound)
		if !ok {
			return
		}
		err := cs.DeleteConversation(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgConversationNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
