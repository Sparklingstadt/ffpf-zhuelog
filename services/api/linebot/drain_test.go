package linebot

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/learning"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// addPending puts a pending row in the fake store.
func (e *env) addPending(id, kind, text string, attempts int, age time.Duration) *store.LineMessage {
	m := &store.LineMessage{
		ID: id, WebhookEventID: "ev-" + id, LineUserID: testLineUser, OwnerID: testOwner,
		Kind: kind, Text: text, Status: store.LineStatusPending, Attempts: attempts,
		CreatedAt: e.clock.Now().Add(-age), UpdatedAt: e.clock.Now().Add(-age),
	}
	e.store.messages = append(e.store.messages, m)
	return m
}

func (e *env) deadline() time.Time { return e.clock.Now().Add(50 * time.Second) }

func TestDrainSuccess(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.addPending("a", "correction", "你好马？", 1, 10*time.Minute)
	e.addPending("b", "translation", "ご飯", 1, 6*time.Minute)
	if err := e.svc.Drain(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if want := t0.Add(-5 * time.Minute); !e.store.listArgs.before.Equal(want) || e.store.listArgs.limit != 20 {
		t.Errorf("list args = %+v, want before=%v limit=20", e.store.listArgs, want)
	}
	if len(e.gen.calls) != 2 || e.gen.calls[0] != (genCall{"correction", "你好马？"}) || e.gen.calls[1] != (genCall{"translation", "ご飯"}) {
		t.Fatalf("generate calls = %v", e.gen.calls)
	}
	for _, id := range []string{"a", "b"} {
		if m := e.store.message(id); m.Status != store.LineStatusDone || m.Attempts != 2 || m.Text != "" {
			t.Errorf("%s = %+v", id, m)
		}
	}
	if len(e.store.entries) != 2 || e.store.entries[0].OriginalText != "你好马？" || e.store.entries[1].Kind != "translation" {
		t.Errorf("entries = %v", e.store.entries)
	}
	if len(e.msg.pushes) != 2 || e.msg.pushTo[0] != testLineUser {
		t.Fatalf("pushes = %v to %v", e.msg.pushes, e.msg.pushTo)
	}
	want := line.FormatResult("correction", "你好马？", "你好吗？", "nǐ hǎo ma?", []string{"吗 は疑問"})
	if len(e.msg.pushes[0]) != 1 || e.msg.pushes[0][0] != want {
		t.Errorf("push = %q, want %q", e.msg.pushes[0], want)
	}
	if len(e.msg.replies) != 0 {
		t.Error("drain has no reply token and must push")
	}
	if len(e.store.pruned) != 1 || !e.store.pruned[0].Equal(t0) {
		t.Errorf("pruned = %v", e.store.pruned)
	}
}

func TestDrainFailureEvenIfRetryable(t *testing.T) {
	for name, genErr := range map[string]error{
		"retryable":     &learning.Error{Code: "OPENAI_TIMEOUT", Retryable: true},
		"non-retryable": &learning.Error{Code: "OPENAI_INVALID_RESPONSE"},
	} {
		e := newEnv(t)
		e.link()
		e.gen.err = genErr
		e.addPending("a", "correction", "你好马？", 1, 10*time.Minute)
		if err := e.svc.Drain(context.Background(), e.deadline()); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		var le *learning.Error
		errors.As(genErr, &le)
		m := e.store.message("a")
		if m.Status != store.LineStatusFailed || m.Text != "" {
			t.Errorf("%s: message = %+v", name, m)
		}
		if len(e.msg.pushes) != 1 || e.msg.pushes[0][0] != line.FormatFailure("correction", le.Code) {
			t.Errorf("%s: pushes = %v", name, e.msg.pushes)
		}
		if len(e.store.entries) != 0 {
			t.Errorf("%s: a note was saved", name)
		}
	}
}

func TestDrainExhaustedRowIsFailedWithoutGenerating(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.addPending("a", "translation", "ご飯", 2, 10*time.Minute)
	if err := e.svc.Drain(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 0 {
		t.Error("an exhausted row must not call OpenAI")
	}
	if m := e.store.message("a"); m.Status != store.LineStatusFailed {
		t.Errorf("status = %q, want failed", m.Status)
	}
	if len(e.msg.pushes) != 1 || e.msg.pushes[0][0] != line.FormatFailure("translation", "OPENAI_TIMEOUT") {
		t.Errorf("pushes = %v", e.msg.pushes)
	}
}

func TestDrainSkipsRowSettledElsewhere(t *testing.T) {
	// Listed as pending with one attempt, but done before Start: nothing to do.
	e := newEnv(t)
	e.link()
	m := e.addPending("a", "correction", "你好马？", 1, 10*time.Minute)
	stale := *m
	m.Status = store.LineStatusDone
	list := &staleStore{fakeStore: e.store, rows: []store.LineMessage{stale}}
	e.svc.Store = list
	if err := e.svc.Drain(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 0 || len(e.msg.pushes) != 0 || e.store.called("FailLineMessage") {
		t.Errorf("settled row had effects: gen=%v pushes=%v calls=%v", e.gen.calls, e.msg.pushes, e.store.calls)
	}
}

type staleStore struct {
	*fakeStore
	rows []store.LineMessage
}

func (s *staleStore) ListStaleLineMessages(context.Context, time.Time, int) ([]store.LineMessage, error) {
	return s.rows, nil
}

func TestDrainStopsStartingRowsPastDeadline(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.addPending("a", "correction", "一", 1, 12*time.Minute)
	e.addPending("b", "correction", "二", 1, 11*time.Minute)
	e.addPending("c", "correction", "三", 1, 10*time.Minute)
	deadline := e.deadline()
	e.gen.after = func() { e.clock.Advance(30 * time.Second) } // 2 rows fit in 50s, the third does not
	if err := e.svc.Drain(context.Background(), deadline); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 2 {
		t.Fatalf("generate calls = %d, want 2", len(e.gen.calls))
	}
	if m := e.store.message("c"); m.Status != store.LineStatusPending || m.Attempts != 1 {
		t.Errorf("third row = %+v, want untouched", m)
	}
	if len(e.store.pruned) != 1 {
		t.Error("PruneLine must still run after the deadline")
	}
}

func TestDrainDeadlineAlreadyPast(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.addPending("a", "correction", "一", 1, 12*time.Minute)
	if err := e.svc.Drain(context.Background(), e.clock.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if e.store.called("StartLineMessageAttempt") || len(e.gen.calls) != 0 {
		t.Error("no row may be started past the deadline")
	}
	if len(e.store.pruned) != 1 {
		t.Error("PruneLine must run")
	}
}

func TestDrainSkipsRecentRows(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.addPending("a", "correction", "一", 1, 4*time.Minute)
	if err := e.svc.Drain(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 0 {
		t.Error("rows younger than 5 minutes belong to the webhook")
	}
}

func TestDrainLinkGoneFailsRowQuietly(t *testing.T) {
	e := newEnv(t) // no link
	e.addPending("a", "correction", "你好马？", 1, 10*time.Minute)
	if err := e.svc.Drain(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if m := e.store.message("a"); m.Status != store.LineStatusFailed || m.Text != "" {
		t.Errorf("message = %+v", m)
	}
	if len(e.gen.calls) != 0 || len(e.msg.pushes) != 0 || len(e.store.entries) != 0 {
		t.Error("an unlinked row must not be generated, saved or announced")
	}
}

func TestDrainLinkMovedToAnotherOwner(t *testing.T) {
	e := newEnv(t)
	e.store.links[testLineUser] = store.LineLink{LineUserID: testLineUser, OwnerID: "owner-2", Role: "member"}
	e.addPending("a", "correction", "你好马？", 1, 10*time.Minute)
	if err := e.svc.Drain(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if m := e.store.message("a"); m.Status != store.LineStatusFailed {
		t.Errorf("status = %q, want failed", m.Status)
	}
	if len(e.gen.calls) != 0 || len(e.store.entries) != 0 {
		t.Error("a note must never land in a different owner's account")
	}
}

func TestDrainInvalidOwnerDeletesLink(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.valid = false
	e.addPending("a", "correction", "你好马？", 1, 10*time.Minute)
	if err := e.svc.Drain(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.store.links) != 0 {
		t.Error("link not deleted")
	}
	if m := e.store.message("a"); m.Status != store.LineStatusFailed {
		t.Errorf("status = %q", m.Status)
	}
	if len(e.msg.pushes) != 1 || e.msg.pushes[0][0] != line.MsgLinkGone {
		t.Errorf("pushes = %v", e.msg.pushes)
	}
	if len(e.gen.calls) != 0 {
		t.Error("generator called")
	}
}

func TestDrainPushFailureIsReportedButLoopContinues(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.msg.pushErr = errBoom
	e.addPending("a", "correction", "一", 1, 12*time.Minute)
	e.addPending("b", "correction", "二", 1, 11*time.Minute)
	err := e.svc.Drain(context.Background(), e.deadline())
	if !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want the push error", err)
	}
	for _, id := range []string{"a", "b"} {
		if m := e.store.message(id); m.Status != store.LineStatusDone {
			t.Errorf("%s = %+v; a failed push must not change DB state", id, m)
		}
	}
	if len(e.store.pruned) != 1 {
		t.Error("PruneLine must still run")
	}
}

func TestDrainFailLineMessageErrorSkipsPush(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.gen.err = &learning.Error{Code: "OPENAI_AUTH_FAILED"}
	e.store.failErr = errBoom
	e.addPending("a", "correction", "一", 1, 12*time.Minute)
	if err := e.svc.Drain(context.Background(), e.deadline()); !errors.Is(err, errBoom) {
		t.Fatalf("err = %v", err)
	}
	if len(e.msg.pushes) != 0 {
		t.Errorf("pushes = %v; a row that could not be failed must not announce failure", e.msg.pushes)
	}
}

func TestDrainCompleteErrors(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.addPending("a", "correction", "一", 1, 12*time.Minute)
	e.store.completeEr = store.ErrNotFound
	if err := e.svc.Drain(context.Background(), e.deadline()); err != nil {
		t.Fatalf("settled elsewhere is not an error: %v", err)
	}
	if len(e.msg.pushes) != 0 {
		t.Error("nothing to push for a row settled elsewhere")
	}

	e2 := newEnv(t)
	e2.link()
	e2.addPending("a", "correction", "一", 1, 12*time.Minute)
	e2.store.completeEr = errBoom
	if err := e2.svc.Drain(context.Background(), e2.deadline()); !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want errBoom", err)
	}
	if len(e2.msg.pushes) != 0 {
		t.Error("nothing was saved, so nothing to push")
	}
}

func TestDrainListErrorStops(t *testing.T) {
	e := newEnv(t)
	e.store.listErr = errBoom
	if err := e.svc.Drain(context.Background(), e.deadline()); !errors.Is(err, errBoom) {
		t.Fatalf("err = %v", err)
	}
}

func TestDrainLogsNothingSensitive(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.gen.err = &learning.Error{Code: "OPENAI_AUTH_FAILED"}
	e.msg.pushErr = errors.New("push " + testLineUser)
	e.addPending("a", "correction", "秘密の本文机密", 1, 12*time.Minute)
	_ = e.svc.Drain(context.Background(), e.deadline())
	out := e.logs.String()
	for _, secret := range []string{"秘密の本文机密", testLineUser} {
		if strings.Contains(out, secret) {
			t.Errorf("log contains %q:\n%s", secret, out)
		}
	}
	if !strings.Contains(out, "OPENAI_AUTH_FAILED") {
		t.Errorf("log lacks the failure code: %q", out)
	}
}
