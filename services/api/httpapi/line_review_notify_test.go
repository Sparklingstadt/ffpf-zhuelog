package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

var cronAuth = map[string]string{"Authorization": "Bearer " + string(testCronSecret)}

func TestLinkReportsTheReviewNotifySetting(t *testing.T) {
	f := &fakeLine{linked: true, reviewNotify: true}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	w := do(h, "GET", "/v1/line/link", "", authHeader)
	if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != `{"linked":true,"reviewNotify":true}` {
		t.Fatalf("GET link = %d %q", w.Code, w.Body)
	}
}

func TestReviewNotifyCanBeTurnedOnAndOff(t *testing.T) {
	f := &fakeLine{linked: true}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	if w := do(h, "PUT", "/v1/line/review-notify", "", authHeader); w.Code != http.StatusOK ||
		strings.TrimSpace(w.Body.String()) != `{"reviewNotify":true}` {
		t.Fatalf("PUT = %d %q", w.Code, w.Body)
	}
	if w := do(h, "DELETE", "/v1/line/review-notify", "", authHeader); w.Code != http.StatusOK ||
		strings.TrimSpace(w.Body.String()) != `{"reviewNotify":false}` {
		t.Fatalf("DELETE = %d %q", w.Code, w.Body)
	}
	if f.setNotifyFor != testOwner || len(f.setNotifyTo) != 2 || !f.setNotifyTo[0] || f.setNotifyTo[1] {
		t.Fatalf("set for %q to %v", f.setNotifyFor, f.setNotifyTo)
	}
}

func TestReviewNotifyWithoutALinkIs404(t *testing.T) {
	f := &fakeLine{setNotifyErr: store.ErrNotFound}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	wantError(t, do(h, "PUT", "/v1/line/review-notify", "", authHeader), http.StatusNotFound, "not_found")
}

func TestReviewNotifyIsClosedToGuestsAndActingAdmins(t *testing.T) {
	h, _, _ := lineRouter(t, auth.RoleGuest, &fakeLine{})
	wantError(t, do(h, "PUT", "/v1/line/review-notify", "", authHeader), http.StatusForbidden, "forbidden")

	a := &fakeAuth{authenticate: func(context.Context, string) (auth.Principal, error) {
		return auth.Principal{OwnerID: testOwner, Role: auth.RoleAdmin, ActorID: "12345"}, nil
	}}
	f := &fakeLine{}
	h2, _, _ := routerWith(t, "", Deps{Auth: a, Line: f, LineChannelSecret: testLineSecret, CronSecret: testCronSecret})
	wantError(t, do(h2, "DELETE", "/v1/line/review-notify", "", authHeader), http.StatusForbidden, "forbidden")
	if len(f.setNotifyTo) != 0 {
		t.Fatal("an acting admin must not change the member's setting")
	}
}

func TestDrainAlsoSendsTheReviewMessages(t *testing.T) {
	f := &fakeLine{}
	h, c, _ := lineRouter(t, auth.RoleMember, f)
	if w := do(h, "GET", "/v1/line/drain", "", cronAuth); w.Code != http.StatusNoContent {
		t.Fatalf("status = %d", w.Code)
	}
	if f.notifyCalls != 1 || !f.notifyDeadline.Equal(c.Now().Add(50*time.Second)) {
		t.Fatalf("notify calls %d, deadline %v", f.notifyCalls, f.notifyDeadline)
	}
}

func TestDrainErrorStillSendsTheReviewMessages(t *testing.T) {
	f := &fakeLine{drainErr: errors.New("boom")}
	h, _, _ := lineRouter(t, auth.RoleMember, f)
	wantError(t, do(h, "GET", "/v1/line/drain", "", cronAuth), http.StatusInternalServerError, "internal")
	if f.notifyCalls != 1 {
		t.Fatal("the review messages must run even after a drain error")
	}

	g := &fakeLine{notifyErr: errors.New("push failed")}
	h, _, _ = lineRouter(t, auth.RoleMember, g)
	wantError(t, do(h, "GET", "/v1/line/drain", "", cronAuth), http.StatusInternalServerError, "internal")
}
