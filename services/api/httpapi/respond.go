// Package httpapi holds the HTTP layer: response helpers, middleware and the
// router. Since stage 11 of the Go retirement it serves only the health routes;
// stage 12 deletes it.
package httpapi

import (
	"encoding/json"
	"net/http"
)

// Fixed client-facing messages. They never include error details.
const (
	msgNotFound         = "見つかりません。"
	msgMethodNotAllowed = "このメソッドは使用できません。"
	msgInternal         = "サーバーでエラーが発生しました。"
	msgUnavailable      = "サービスを利用できません。"
)

// Error codes in the {"error":{"code":...}} body.
const (
	codeNotFound         = "not_found"
	codeMethodNotAllowed = "method_not_allowed"
	codeUnavailable      = "unavailable"
	codeInternal         = "internal"
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
