// Package httpapi holds the HTTP layer: response helpers, middleware, the
// router and the handlers.
package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// Fixed client-facing messages. They never include error details.
const (
	msgUnauthorized      = "認証が必要です。"
	msgForbidden         = "このアカウントは利用できません。" // allowlist removal, revoked session
	msgAdminOnly         = "管理者だけが利用できます。"
	msgLineNotLinked     = "LINE と連携していません。先に連携してください。"
	msgInvalidMonth      = "月は YYYY-MM の形で指定してください。"
	msgMembersOnly       = "この操作は会員だけが利用できます。"
	msgSelfFollow        = "自分はフォローできません。"
	msgBadRequest        = "リクエストが不正です。"
	msgNotFound          = "見つかりません。"
	msgMethodNotAllowed  = "このメソッドは使用できません。"
	msgTooLarge          = "リクエストが大きすぎます。"
	msgRateLimited       = "しばらくしてから再度お試しください。"
	msgGitHubUnavailable = "GitHub に接続できませんでした。"
	msgFFPFUnavailable   = "FFPF ID に接続できませんでした。"
	msgInternal          = "サーバーでエラーが発生しました。"
	msgUnavailable       = "サービスを利用できません。"
	msgWebOnly           = "この操作は Web からだけ利用できます。"
	msgActAsAdminOnly    = "他の人として操作できるのは管理者だけです。"
	msgMemberNotFound    = "会員が見つかりません。"
	msgNotWhileActing    = "会員として操作している間は使えません。"
	msgDemoRestricted    = "デモでは使えません。"
	msgDemoDisabled      = "デモは利用できません。"

	msgInvalidNewPassword     = "パスワードは12〜128文字にしてください。"
	msgPasswordMismatch       = "確認用のパスワードが一致しません。"
	msgInvalidCurrentPassword = "現在のパスワードが違うか、一時的にロックされています。"

	msgInvalidLoginID  = "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。"
	msgInvalidName     = "表示名は1〜50文字にしてください。"
	msgLoginIDTaken    = "このログインIDはすでに使われています。"
	msgAccountNotFound = "アカウントが見つかりません。"

	msgSelectCSVFile   = "CSVファイルを選択してください。"
	msgCSVFileTooLarge = "ファイルは4MB以下にしてください。"
	msgCSVExtension    = "拡張子が.csvのファイルを選択してください。"

	msgChatInvalid          = "会話内容が上限を超えているか、形式が不正です。"
	msgChatFailed           = "ChatGPTから応答を受信できませんでした。"
	msgConversationNotFound = "会話が見つかりません。"

	msgPracticeRecordInvalid  = "練習の記録の形式が不正です。"
	msgPracticeRecordNotFound = "練習の記録が見つかりません。"

	msgReviewInvalid  = "復習の回答の形式が不正です。"
	msgReviewNotFound = "復習する問題が見つかりません。"

	msgStudyLogInvalid = "学習ログの期間が不正です。YYYY-MM-DD で、93日以内にしてください。"
)

// Error codes in the {"error":{"code":...}} body.
const (
	codeInvalidRequest         = "invalid_request"
	codeUnauthorized           = "unauthorized"
	codeForbidden              = "forbidden"
	codeNotFound               = "not_found"
	codeMethodNotAllowed       = "method_not_allowed"
	codeTooLarge               = "too_large"
	codeRateLimited            = "rate_limited"
	codeUnavailable            = "unavailable"
	codeInternal               = "internal"
	codeGitHubUnavailable      = "github_unavailable"
	codeFFPFUnavailable        = "ffpf_unavailable"
	codePasswordMismatch       = "password_mismatch"
	codeInvalidCurrentPassword = "invalid_current_password"
	codeSelfFollow             = "self_follow"
	codeLoginIDTaken           = "login_id_taken"
	codeInvalidCSV             = "invalid_csv"
	codeChatFailed             = "chat_failed"
)

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// writeJSON writes v as the JSON response body with the given status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		status = http.StatusInternalServerError
		body = []byte(`{"error":{"code":"` + codeInternal + `","message":"` + msgInternal + `"}}`)
	}
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// writeError writes the standard error shape.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorEnvelope{Error: errorBody{Code: code, Message: message}})
}

// writeStoreError answers a failed store call: 404 with notFoundMsg for
// store.ErrNotFound, and writeServiceError's answer for any other error.
func writeStoreError(w http.ResponseWriter, r *http.Request, err error, notFoundMsg string) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, codeNotFound, notFoundMsg)
		return
	}
	writeServiceError(w, r, err)
}

// writeServiceError maps an error from the auth service or the store to its
// HTTP response. Unrecognised errors are logged (they never contain secrets)
// and reported to the client as a generic 500.
func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	var tooLarge *http.MaxBytesError
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, codeUnauthorized, msgUnauthorized)
	case errors.Is(err, auth.ErrForbidden):
		writeError(w, http.StatusForbidden, codeForbidden, msgForbidden)
	case errors.Is(err, auth.ErrThrottled):
		writeError(w, http.StatusTooManyRequests, codeRateLimited, msgRateLimited)
	case errors.Is(err, auth.ErrInvalidNewPassword):
		writeError(w, http.StatusBadRequest, codeInvalidRequest, msgInvalidNewPassword)
	case errors.Is(err, auth.ErrPasswordMismatch):
		writeError(w, http.StatusBadRequest, codePasswordMismatch, msgPasswordMismatch)
	case errors.Is(err, auth.ErrInvalidCurrentPassword):
		writeError(w, http.StatusBadRequest, codeInvalidCurrentPassword, msgInvalidCurrentPassword)
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, codeNotFound, msgNotFound)
	case errors.Is(err, auth.ErrGitHubUnavailable):
		writeError(w, http.StatusBadGateway, codeGitHubUnavailable, msgGitHubUnavailable)
	case errors.Is(err, auth.ErrFFPFUnavailable):
		writeError(w, http.StatusBadGateway, codeFFPFUnavailable, msgFFPFUnavailable)
	case errors.Is(err, auth.ErrDemoDisabled):
		writeError(w, http.StatusNotFound, codeNotFound, msgDemoDisabled)
	case errors.Is(err, auth.ErrFFPFDisabled):
		writeError(w, http.StatusServiceUnavailable, codeUnavailable, msgUnavailable)
	case errors.As(err, &tooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, codeTooLarge, msgTooLarge)
	default:
		loggerFrom(r.Context()).Error("request failed", "error", err.Error())
		writeError(w, http.StatusInternalServerError, codeInternal, msgInternal)
	}
}

// writeBadRequest answers 400 with the generic invalid_request message.
func writeBadRequest(w http.ResponseWriter) {
	writeError(w, http.StatusBadRequest, codeInvalidRequest, msgBadRequest)
}

// writeNotFound answers 404 with the generic not_found message.
func writeNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, codeNotFound, msgNotFound)
}

// writeForbidden answers 403 with a role-specific message.
func writeForbidden(w http.ResponseWriter, msg string) {
	writeError(w, http.StatusForbidden, codeForbidden, msg)
}

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// validUUID reports whether s is a UUID in lower-case hex (any version), the
// form of the ids the browser makes for conversations, practice rounds,
// vocabulary words, questions and review logs.
func validUUID(s string) bool { return uuidPattern.MatchString(s) }

// pathValue returns the named path value if valid accepts it; otherwise it
// answers 404 itself and returns false, since such a value cannot name any row.
func pathValue(w http.ResponseWriter, r *http.Request, name string, valid func(string) bool) (string, bool) {
	return pathValueMsg(w, r, name, valid, msgNotFound)
}

// pathValueMsg is pathValue with a resource-specific 404 message.
func pathValueMsg(w http.ResponseWriter, r *http.Request, name string, valid func(string) bool, msg string) (string, bool) {
	v := r.PathValue(name)
	if !valid(v) {
		writeError(w, http.StatusNotFound, codeNotFound, msg)
		return "", false
	}
	return v, true
}

// decodeBody reads exactly one JSON object from the request body into dst,
// rejecting null and other non-objects, unknown fields and any data after the
// object.
func decodeBody(r *http.Request, dst any) error {
	var raw json.RawMessage
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&raw); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("httpapi: unexpected data after JSON value")
		}
		return err
	}
	if len(raw) == 0 || raw[0] != '{' {
		return errInvalidBody
	}
	inner := json.NewDecoder(bytes.NewReader(raw))
	inner.DisallowUnknownFields()
	return inner.Decode(dst)
}

// writeBodyError answers a request body that could not be decoded: 413 when
// it exceeded the size limit, otherwise 400.
func writeBodyError(w http.ResponseWriter, r *http.Request, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeServiceError(w, r, err)
		return
	}
	writeBadRequest(w)
}
