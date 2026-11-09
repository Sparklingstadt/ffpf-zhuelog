package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

// demoResetPath is the nightly reset of the demo account.
const demoResetPath = "/v1/cron/demo-reset"

// demoResetTimeout bounds one reset; it fits in the server's 30 s write
// timeout.
const demoResetTimeout = 25 * time.Second

// DemoResetter puts the demo account back to its fixture; *demo.Resetter
// satisfies it.
type DemoResetter interface {
	Reset(ctx context.Context, now time.Time) error
}

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

// notDemo answers 403 to the demo account. The routes it wraps call OpenAI,
// reach other members (follows, sharing) or change the account (password,
// LINE); everything else the demo may use like any member.
func notDemo(a Auth, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		demo, err := a.IsDemo(r.Context(), principalFrom(r.Context()))
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		if demo {
			writeForbidden(w, msgDemoRestricted)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// demoReset puts the demo account back to its fixture. Only the scheduler
// (or the admin, by hand) may call it: the request must carry
// "Authorization: Bearer <CRON_SECRET>", and with no secret configured every
// request is refused, as for the LINE drain.
func demoReset(reset DemoResetter, cronSecret []byte, now func() time.Time) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !bearerMatches(r.Header.Get("Authorization"), cronSecret) {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, msgUnauthorized)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), demoResetTimeout)
		defer cancel()
		if err := reset.Reset(ctx, now()); err != nil {
			writeServiceError(w, r, err)
			return
		}
		loggerFrom(r.Context()).Info("demo account reset")
		w.WriteHeader(http.StatusNoContent)
	})
}
