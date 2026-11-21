package httpapi

import (
	"errors"
	"io"
	"net/http"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

// demoStatus answers 204 when the demo account is configured and 404
// otherwise, so the sign-in page knows whether to offer it.
func demoStatus(a Auth) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if !a.DemoEnabled() {
			writeError(w, http.StatusNotFound, codeNotFound, msgDemoDisabled)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// loginDemo starts a session for the demo account. Like the guest login, the
// body may be empty or "{}"; any field is rejected.
func loginDemo(a Auth, clientKey func(*http.Request) string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct{}
		if err := decodeBody(r, &req); err != nil && !errors.Is(err, io.EOF) {
			writeBodyError(w, r, err)
			return
		}
		pair, err := a.LoginDemo(r.Context(), auth.ClientAddress(clientKey(r)))
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeTokens(w, pair)
	})
}
