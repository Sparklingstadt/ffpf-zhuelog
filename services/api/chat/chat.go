// Package chat holds the admin's practice chat with ChatGPT: the system
// prompt, the limits on a conversation and the streaming OpenAI call.
package chat

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const (
	// MaxMessages and MaxTotalChars bound one request (and one saved
	// conversation). Characters are counted as runes.
	MaxMessages   = 40
	MaxTotalChars = 40_000
	// MaxAnswerChars bounds a saved answer. It is far above what
	// maxOutputTokens can produce, so no real answer reaches it.
	MaxAnswerChars = 20_000
	// maxOutputTokens bounds one answer.
	maxOutputTokens = 1600
)

// SystemPrompt is sent as the instructions of every chat request.
const SystemPrompt = `あなたは中国語学習アプリ「学习録」の会話パートナーです。
ユーザーの中国語学習を支援してください。
- 原則として、ユーザーが使った言語に合わせて答える。
- 中国語の例文には、必要に応じてピン音と自然な日本語訳を添える。
- 間違いを直すときは、自然な修正文と短い理由を示す。
- 会話練習では細かい訂正で流れを止めすぎず、会話を続けてから要点を整理する。
- 確信がない内容を断定しない。
- 回答は学習しやすい長さにまとめる。`

// Message is one turn sent to ChatGPT. Role is "user" or "assistant".
type Message struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

// ErrInvalid reports messages outside the limits or in the wrong shape.
var ErrInvalid = errors.New("chat: invalid messages")

// Validate checks that there are 1 to MaxMessages messages, every role is
// user or assistant, the last one is the user's, no text is blank and the
// texts add up to at most MaxTotalChars.
func Validate(msgs []Message) error {
	if len(msgs) == 0 || len(msgs) > MaxMessages || msgs[len(msgs)-1].Role != "user" {
		return ErrInvalid
	}
	total := 0
	for _, m := range msgs {
		if (m.Role != "user" && m.Role != "assistant") || strings.TrimSpace(m.Text) == "" {
			return ErrInvalid
		}
		total += utf8.RuneCountInString(m.Text)
	}
	if total > MaxTotalChars {
		return ErrInvalid
	}
	return nil
}
