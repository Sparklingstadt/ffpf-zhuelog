// Package httpapi holds the HTTP layer: response helpers, middleware, the
// router and the handlers.
package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// Fixed client-facing messages. They never include error details.
const (
	msgUnauthorized      = "認証が必要です。"
	msgForbidden         = "このアカウントは利用できません。"
	msgShareMembersOnly  = "共有できるのは会員だけです。"
	msgSelfFollow        = "自分はフォローできません。"
	msgAdminOnlyView     = "他の人の記録は管理者だけが見られます。"
	msgBadRequest        = "リクエストが不正です。"
	msgNotFound          = "見つかりません。"
	msgMethodNotAllowed  = "このメソッドは使用できません。"
	msgTooLarge          = "リクエストが大きすぎます。"
	msgRateLimited       = "しばらくしてから再度お試しください。"
	msgGitHubUnavailable = "GitHub に接続できませんでした。"
	msgInternal          = "サーバーでエラーが発生しました。"
	msgUnavailable       = "サービスを利用できません。"

	msgInvalidNewPassword     = "パスワードは12〜128文字にしてください。"
	msgPasswordMismatch       = "確認用のパスワードが一致しません。"
	msgInvalidCurrentPassword = "現在のパスワードが違うか、一時的にロックされています。"

	msgSelectCSVFile   = "CSVファイルを選択してください。"
	msgCSVFileTooLarge = "ファイルは5MB以下にしてください。"
	msgCSVExtension    = "拡張子が.csvのファイルを選択してください。"
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
		body = []byte(`{"error":{"code":"internal","message":"` + msgInternal + `"}}`)
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

// writeServiceError maps an error from the auth service or the store to its
// HTTP response. Unrecognised errors are logged (they never contain secrets)
// and reported to the client as a generic 500.
func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	var tooLarge *http.MaxBytesError
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "unauthorized", msgUnauthorized)
	case errors.Is(err, auth.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden", msgForbidden)
	case errors.Is(err, auth.ErrInvalidNewPassword):
		writeError(w, http.StatusBadRequest, "invalid_request", msgInvalidNewPassword)
	case errors.Is(err, auth.ErrPasswordMismatch):
		writeError(w, http.StatusBadRequest, "password_mismatch", msgPasswordMismatch)
	case errors.Is(err, auth.ErrInvalidCurrentPassword):
		writeError(w, http.StatusBadRequest, "invalid_current_password", msgInvalidCurrentPassword)
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", msgNotFound)
	case errors.Is(err, auth.ErrGitHubUnavailable):
		writeError(w, http.StatusBadGateway, "github_unavailable", msgGitHubUnavailable)
	case errors.As(err, &tooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", msgTooLarge)
	default:
		loggerFrom(r.Context()).Error("request failed", "error", err.Error())
		writeError(w, http.StatusInternalServerError, "internal", msgInternal)
	}
}

// writeBodyError answers a request body that could not be decoded: 413 when
// it exceeded the size limit, otherwise 400.
func writeBodyError(w http.ResponseWriter, r *http.Request, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeServiceError(w, r, err)
		return
	}
	writeError(w, http.StatusBadRequest, "invalid_request", msgBadRequest)
}
