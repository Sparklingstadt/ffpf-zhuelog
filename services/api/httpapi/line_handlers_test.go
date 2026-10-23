package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
)

var (
	testLineSecret = []byte("line-channel-secret")
	testCronSecret = []byte("cron-secret-value")
)

// fakeLine records what the handlers pass to the LINE service.
type fakeLine struct {
	handled   []line.Event
	handleErr error

	issueErr   error
	issuedFor  auth.Principal
	issueCalls int

	linked    bool
	linkedErr error
	linkedFor string

	unlinkCalls int
	unlinkedFor string
	unlinkErr   error

	drainCalls    int
	drainDeadline time.Time
	drainErr      error
}

var testCodeExpiry = time.Date(2026, 10, 20, 12, 10, 0, 123000000, time.FixedZone("JST", 9*3600))

func (f *fakeLine) HandleEvent(_ context.Context, ev line.Event) error {
	f.handled = append(f.handled, ev)
	return f.handleErr
}

func (f *fakeLine) IssueCode(_ context.Context, p auth.Principal) (string, time.Time, error) {
	f.issueCalls++
	f.issuedFor = p
	if f.issueErr != nil {
		return "", time.Time{}, f.issueErr
	}
	return "ABCD2345", testCodeExpiry, nil
}

func (f *fakeLine) Linked(_ context.Context, ownerID string) (bool, error) {
	f.linkedFor = ownerID
	return f.linked, f.linkedErr
}

func (f *fakeLine) Unlink(_ context.Context, ownerID string) error {
	f.unlinkCalls++
	f.unlinkedFor = ownerID
	return f.unlinkErr
}

func (f *fakeLine) Drain(_ context.Context, deadline time.Time) error {
	f.drainCalls++
	f.drainDeadline = deadline
	return f.drainErr
}

func lineSig(secret []byte, body string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(body))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func lineRouter(t *testing.T, role string, f *fakeLine) (http.Handler, *clock, *bytes.Buffer) {
	t.Helper()
	return routerWith(t, role, Deps{Line: f, LineChannelSecret: testLineSecret, CronSecret: testCronSecret})
}

func postWebhook(h http.Handler, body, sig string) *httptest.ResponseRecorder {
	headers := map[string]string{}
	if sig != "" {
		headers["X-Line-Signature"] = sig
	}
	return do(h, "POST", "/v1/line/webhook", body, headers)
}

const twoEventBody = `{"destination":"x","events":[
{"type":"message","webhookEventId":"E1","replyToken":"r1","source":{"type":"user","userId":"U1"},"message":{"type":"text","text":"你好"}},
{"type":"message","webhookEventId":"E2","replyToken":"r2","source":{"type":"user","userId":"U1"},"message":{"type":"text","text":"こんにちは"}}]}`

func TestWebhookRejectsMissingOrWrongSignature(t *testing.T) {
	f := &fakeLine{}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	body := `{"destination":"x","events":[]}`
	for name, sig := range map[string]string{
		"missing":       "",
		"wrong secret":  lineSig([]byte("other"), body),
		"other body":    lineSig(testLineSecret, body+" "),
		"not base64":    "!!!",
		"empty-looking": " ",
	} {
		t.Run(name, func(t *testing.T) {
			wantError(t, postWebhook(h, body, sig), http.StatusUnauthorized, "unauthorized")
		})
	}
	if len(f.handled) != 0 {
		t.Errorf("HandleEvent called %d times for unsigned requests", len(f.handled))
	}
}

func TestWebhookVerifyDeliveryWithNoEvents(t *testing.T) {
	f := &fakeLine{}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	body := `{"destination":"x","events":[]}`
	w := postWebhook(h, body, lineSig(testLineSecret, body))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", w.Code, w.Body.String())
	}
	if len(f.handled) != 0 {
		t.Errorf("HandleEvent called for an empty delivery")
	}
}

func TestWebhookHandlesEveryEvent(t *testing.T) {
	f := &fakeLine{}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	w := postWebhook(h, twoEventBody, lineSig(testLineSecret, twoEventBody))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", w.Code, w.Body.String())
	}
	if len(f.handled) != 2 || f.handled[0].WebhookEventID != "E1" || f.handled[1].WebhookEventID != "E2" {
		t.Fatalf("handled = %+v, want E1 then E2", f.handled)
	}
}

func TestWebhookAnswers200WhenAnEventFailsAndKeepsGoing(t *testing.T) {
	f := &fakeLine{handleErr: errors.New("secret-user-text 你好 U1")}
	h, _, logs := lineRouter(t, auth.RoleMember, f)
	w := postWebhook(h, twoEventBody, lineSig(testLineSecret, twoEventBody))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 so LINE does not redeliver (body %q)", w.Code, w.Body.String())
	}
	if len(f.handled) != 2 {
		t.Errorf("handled %d events, want both", len(f.handled))
	}
	out := logs.String()
	if !strings.Contains(out, "E1") {
		t.Errorf("failure log does not name the event ID: %s", out)
	}
	for _, leak := range []string{"secret-user-text", "你好", "U1\""} {
		if strings.Contains(out, leak) {
			t.Errorf("log contains %q: %s", leak, out)
		}
	}
}

func TestWebhookMalformedSignedBodyIs400(t *testing.T) {
	f := &fakeLine{}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	body := `{not json`
	wantError(t, postWebhook(h, body, lineSig(testLineSecret, body)), http.StatusBadRequest, "invalid_request")
}

func TestWebhookOversizedBodyIs413(t *testing.T) {
	f := &fakeLine{}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	body := `{"events":[],"pad":"` + strings.Repeat("a", maxBodyBytes) + `"}`
	wantError(t, postWebhook(h, body, lineSig(testLineSecret, body)), http.StatusRequestEntityTooLarge, "too_large")
}

func TestLinkRoutesAllowMembersAndAdmins(t *testing.T) {
	for _, role := range []string{auth.RoleMember, auth.RoleAdmin} {
		t.Run(role, func(t *testing.T) {
			f := &fakeLine{linked: true}
			h, _, _ := lineRouter(t, role, f)

			w := do(h, "GET", "/v1/line/link", "", authHeader)
			if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != `{"linked":true}` {
				t.Errorf("GET link = %d %q", w.Code, w.Body.String())
			}
			if f.linkedFor != testOwner {
				t.Errorf("Linked asked about %q, want %q", f.linkedFor, testOwner)
			}

			w = do(h, "POST", "/v1/line/link-code", "", authHeader)
			if w.Code != http.StatusOK {
				t.Fatalf("POST link-code = %d %q", w.Code, w.Body.String())
			}
			var got map[string]string
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			want := map[string]string{"code": "ABCD2345", "expiresAt": "2026-10-20T03:10:00.123Z"}
			if len(got) != 2 || got["code"] != want["code"] || got["expiresAt"] != want["expiresAt"] {
				t.Errorf("link-code body = %v, want %v", got, want)
			}
			if f.issuedFor.OwnerID != testOwner || f.issuedFor.Role != role {
				t.Errorf("IssueCode principal = %+v", f.issuedFor)
			}
			if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
				t.Errorf("Cache-Control = %q, want no-store", cc)
			}

			w = do(h, "DELETE", "/v1/line/link", "", authHeader)
			if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
				t.Errorf("DELETE link = %d %q", w.Code, w.Body.String())
			}
			if f.unlinkedFor != testOwner {
				t.Errorf("Unlink owner = %q", f.unlinkedFor)
			}
		})
	}
}

func TestLinkRoutesRejectGuestsAndAnonymous(t *testing.T) {
	routes := [][2]string{{"GET", "/v1/line/link"}, {"POST", "/v1/line/link-code"}, {"DELETE", "/v1/line/link"}}
	f := &fakeLine{}
	h, _, _ := lineRouter(t, auth.RoleGuest, f)
	for _, r := range routes {
		wantError(t, do(h, r[0], r[1], "", authHeader), http.StatusForbidden, "forbidden")
		wantError(t, do(h, r[0], r[1], "", nil), http.StatusUnauthorized, "unauthorized")
	}
	if f.issueCalls != 0 || f.unlinkCalls != 0 || f.linkedFor != "" {
		t.Errorf("service was called for a guest: %+v", f)
	}
}

func TestLinkRoutesMapServiceErrors(t *testing.T) {
	f := &fakeLine{linkedErr: errors.New("db down"), issueErr: auth.ErrForbidden, unlinkErr: errors.New("db down")}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	wantError(t, do(h, "GET", "/v1/line/link", "", authHeader), http.StatusInternalServerError, "internal")
	wantError(t, do(h, "POST", "/v1/line/link-code", "", authHeader), http.StatusForbidden, "forbidden")
	wantError(t, do(h, "DELETE", "/v1/line/link", "", authHeader), http.StatusInternalServerError, "internal")
}

func TestUnlinkWhenNotLinkedIs204(t *testing.T) {
	f := &fakeLine{linked: false}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	if w := do(h, "DELETE", "/v1/line/link", "", authHeader); w.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", w.Code)
	}
}

func TestDrainRequiresTheCronSecret(t *testing.T) {
	cases := map[string]struct {
		cron   []byte
		header string
	}{
		"secret unset, no header":    {nil, ""},
		"secret unset, empty bearer": {nil, "Bearer "},
		"wrong secret":               {testCronSecret, "Bearer nope"},
		"no header":                  {testCronSecret, ""},
		"wrong scheme":               {testCronSecret, "Basic " + string(testCronSecret)},
		"prefix of the secret":       {testCronSecret, "Bearer " + string(testCronSecret[:5])},
		"secret plus suffix":         {testCronSecret, "Bearer " + string(testCronSecret) + "x"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			f := &fakeLine{}
			h, _, _ := routerWith(t, auth.RoleMember, Deps{Line: f, LineChannelSecret: testLineSecret, CronSecret: c.cron})
			headers := map[string]string{}
			if c.header != "" {
				headers["Authorization"] = c.header
			}
			wantError(t, do(h, "GET", "/v1/line/drain", "", headers), http.StatusUnauthorized, "unauthorized")
			if f.drainCalls != 0 {
				t.Error("Drain ran without a valid secret")
			}
		})
	}
}

func TestDrainRunsWithTheCronSecret(t *testing.T) {
	f := &fakeLine{}
	h, c, _ := lineRouter(t, auth.RoleMember, f)
	w := do(h, "GET", "/v1/line/drain", "", map[string]string{"Authorization": "Bearer " + string(testCronSecret)})
	if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
		t.Fatalf("status = %d %q, want 204", w.Code, w.Body.String())
	}
	if f.drainCalls != 1 {
		t.Fatalf("Drain called %d times", f.drainCalls)
	}
	if want := c.Now().Add(50 * time.Second); !f.drainDeadline.Equal(want) {
		t.Errorf("deadline = %v, want start + 50s = %v", f.drainDeadline, want)
	}
}

func TestDrainErrorIs500(t *testing.T) {
	f := &fakeLine{drainErr: errors.New("linebot: prune: boom")}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	w := do(h, "GET", "/v1/line/drain", "", map[string]string{"Authorization": "Bearer " + string(testCronSecret)})
	wantError(t, w, http.StatusInternalServerError, "internal")
}

func TestLineRoutesAreAbsentWithoutService(t *testing.T) {
	h, _, _ := routerWith(t, auth.RoleMember, Deps{LineChannelSecret: testLineSecret, CronSecret: testCronSecret})
	for _, r := range [][2]string{
		{"POST", "/v1/line/webhook"},
		{"GET", "/v1/line/link"},
		{"POST", "/v1/line/link-code"},
		{"DELETE", "/v1/line/link"},
		{"GET", "/v1/line/drain"},
	} {
		w := do(h, r[0], r[1], "", map[string]string{"Authorization": "Bearer tok"})
		wantError(t, w, http.StatusNotFound, "not_found")
	}
}
