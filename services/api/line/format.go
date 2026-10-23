package line

import (
	"strings"
	"unicode/utf8"
)

// maxMessageRunes is LINE's limit for one text message.
const maxMessageRunes = 5000

// Reply copy. These go to LINE users verbatim.
const (
	MsgLinked    = "連携しました。これから、このトークに送った文を添削・翻訳して学習ノートに保存します。"
	MsgRelinked  = "連携先を切り替えました。これからは新しいアカウントの学習ノートに保存します。"
	MsgBadCode   = "コードが違うか期限が切れています。Web の連携画面で新しいコードを出して、もう一度送ってください。"
	MsgThrottled = "しばらくしてから試してください。"
	MsgNotLinked = "まだ連携していません。Web のアカウント画面（/account/line）で連携コードを出して、このトークに送ってください。"
	MsgLinkGone  = "連携が切れました。もう一度つなぐには、Web のアカウント画面（/account/line）で連携コードを出して、このトークに送ってください。"
	MsgTooLong   = "文が長すぎます。500 文字までにして、もう一度送ってください。"
	MsgUsage     = "中国語の文を送ると添削します。日本語の文を送ると中国語に翻訳します。結果は学習ノートに保存されます。"
	MsgSlow      = "少し時間がかかっています。結果は出来しだい、このトークにお送りします。"
)

const savedFooter = "学習ノートに保存しました"

// FormatResult builds the reply for a finished correction or translation. kind
// is "correction" or "translation"; text is the corrected or translated text.
// Empty pinyin and hints sections are left out. The result is clamped to one
// LINE message, which the documented generation limits never reach.
func FormatResult(kind, original, text, pinyin string, hints []string) string {
	textHeading := "【添削後】"
	if kind == "translation" {
		textHeading = "【中国語訳】"
	}
	sections := []string{
		"【元の文】\n" + original,
		textHeading + "\n" + text,
	}
	if pinyin != "" {
		sections = append(sections, "【ピン音】\n"+pinyin)
	}
	if len(hints) > 0 {
		lines := make([]string, len(hints))
		for i, h := range hints {
			lines[i] = "・" + h
		}
		sections = append(sections, "【ヒント】\n"+strings.Join(lines, "\n"))
	}
	body := strings.Join(sections, "\n\n")
	suffix := "\n\n" + savedFooter
	if limit := maxMessageRunes - utf8.RuneCountInString(suffix); utf8.RuneCountInString(body) > limit {
		body = string([]rune(body)[:limit])
	}
	return body + suffix
}

// FormatFailure builds the reply for a failed correction or translation: a
// short reason for the known codes, then the code itself.
func FormatFailure(kind, code string) string {
	head := "添削できませんでした。"
	if kind == "translation" {
		head = "翻訳できませんでした。"
	}
	return head + failureReason(code) + "\n（コード: " + code + "）"
}

func failureReason(code string) string {
	switch code {
	case "OPENAI_RATE_LIMITED":
		return "AI の利用が混み合っています。しばらくしてからもう一度送ってください。"
	case "OPENAI_INVALID_RESPONSE":
		return "AI の返事を読み取れませんでした。文を変えてもう一度送ってください。"
	case "OPENAI_AUTH_FAILED":
		return "AI との接続の設定に問題があります。管理者に知らせてください。"
	case "OPENAI_TIMEOUT":
		return "AI の返事が間に合いませんでした。しばらくしてからもう一度送ってください。"
	default:
		return "うまく処理できませんでした。しばらくしてからもう一度送ってください。"
	}
}
