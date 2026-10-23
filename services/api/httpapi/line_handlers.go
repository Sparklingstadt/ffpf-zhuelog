package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
)

// LineService is what the LINE handlers need from *linebot.Service.
type LineService interface {
	HandleEvent(ctx context.Context, ev line.Event) error
	IssueCode(ctx context.Context, p auth.Principal) (string, time.Time, error)
	Linked(ctx context.Context, ownerID string) (bool, error)
	Unlink(ctx context.Context, ownerID string) error
	Drain(ctx context.Context, deadline time.Time) error
}

const (
	lineWebhookPath = "/v1/line/webhook"
	lineDrainPath   = "/v1/line/drain"

	// lineWriteTimeout is how long the webhook and drain handlers may take to
	// answer. It is longer than the server's 30 s WriteTimeout (a generation
	// can take 20 s) and matches the 60 s maximum duration in vercel.json.
	lineWriteTimeout = 60 * time.Second
	// drainBudget is how long a drain pass may run, leaving room under
	// lineWriteTimeout to prune and answer.
	drainBudget = 50 * time.Second
)

// extendLineDeadlines gives one request longer read and write deadlines than
// the server's, like extendCSVDeadlines. It runs after the caller's credential
// has been checked, so unauthenticated requests keep the server's deadlines.
// Writers that cannot set deadlines (http.ErrNotSupported, as in
// httptest.ResponseRecorder) are left alone.
func extendLineDeadlines(w http.ResponseWriter) {
	rc := http.NewResponseController(w)
	now := time.Now()
	_ = rc.SetReadDeadline(now.Add(lineWriteTimeout))
	_ = rc.SetWriteDeadline(now.Add(lineWriteTimeout))
}

// lineWebhook receives LINE webhook deliveries. The signature is checked on
// the raw body before anything is parsed. Once it passes, the answer is 200
// whatever happens to the individual events, so LINE does not redeliver them:
// a message that could not be finished stays pending for the retry endpoint.
// Message text is never logged.
func lineWebhook(svc LineService, channelSecret []byte) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeBodyError(w, r, err)
			return
		}
		if !line.VerifySignature(channelSecret, body, r.Header.Get("X-Line-Signature")) {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, msgUnauthorized)
			return
		}
		extendLineDeadlines(w)
		events, err := line.ParseWebhook(body)
		if err != nil {
			writeBadRequest(w)
			return
		}
		for _, ev := range events {
			if err := svc.HandleEvent(r.Context(), ev); err != nil {
				// The error is not logged: it may carry more than an event ID.
				// The service has already logged what it can safely say.
				loggerFrom(r.Context()).Warn("line event failed", "event_id", ev.WebhookEventID)
			}
		}
		writeJSON(w, http.StatusOK, struct{}{})
	})
}

// lineLinked tells the caller whether a LINE account is linked. The LINE user
// ID is never returned.
func lineLinked(svc LineService) http.Handler {
	type response struct {
		Linked bool `json:"linked"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		linked, err := svc.Linked(r.Context(), principalFrom(r.Context()).OwnerID)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, response{Linked: linked})
	})
}

// lineLinkCode issues a link code, shown once; a new code replaces the
// caller's previous one. The code is never logged.
func lineLinkCode(svc LineService) http.Handler {
	type response struct {
		Code      string `json:"code"`
		ExpiresAt string `json:"expiresAt"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		code, expiresAt, err := svc.IssueCode(r.Context(), principalFrom(r.Context()))
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, response{Code: code, ExpiresAt: formatTime(expiresAt)})
	})
}

// lineUnlink removes the caller's link; it is 204 when there is none.
func lineUnlink(svc LineService) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := svc.Unlink(r.Context(), principalFrom(r.Context()).OwnerID); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// lineDrain finishes the messages left pending. Only the scheduler may call
// it: the request must carry "Authorization: Bearer <CRON_SECRET>", and with no
// secret configured every request is refused. Vercel Cron calls with GET.
func lineDrain(svc LineService, cronSecret []byte, now func() time.Time) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !bearerMatches(r.Header.Get("Authorization"), cronSecret) {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, msgUnauthorized)
			return
		}
		extendLineDeadlines(w)
		if err := svc.Drain(r.Context(), now().Add(drainBudget)); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// bearerMatches reports whether header is "Bearer <secret>". An empty secret
// never matches. Both sides are hashed first so the comparison takes the same
// time whatever the length of the presented token.
func bearerMatches(header string, secret []byte) bool {
	if len(secret) == 0 {
		return false
	}
	scheme, token, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return false
	}
	want := sha256.Sum256(secret)
	got := sha256.Sum256([]byte(token))
	return subtle.ConstantTimeCompare(want[:], got[:]) == 1
}
