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

func TestNotLinkedPlainText(t *testing.T) {
	e := newEnv(t)
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好吗"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if got := e.onlyReply(t); got != line.MsgNotLinked {
		t.Errorf("reply = %q, want MsgNotLinked", got)
	}
	if len(e.gen.calls) != 0 || e.store.called("InsertLineMessage") {
		t.Error("an unlinked user must not reach generation or storage")
	}
	if e.store.called("ConsumeThrottle") {
		t.Error("non-code text must not touch the link-code throttle")
	}
}

func TestNotLinkedNonText(t *testing.T) {
	e := newEnv(t)
	ev := line.Event{WebhookEventID: "e1", ReplyToken: "t", UserID: testLineUser, FromUser: true}
	if err := e.svc.HandleEvent(context.Background(), ev, e.deadline()); err != nil {
		t.Fatal(err)
	}
	if got := e.onlyReply(t); got != line.MsgNotLinked {
		t.Errorf("reply = %q, want MsgNotLinked", got)
	}
}

func TestGroupAndRoomEventsAreIgnored(t *testing.T) {
	for name, linked := range map[string]bool{"unlinked": false, "linked": true} {
		e := newEnv(t)
		if linked {
			e.link()
		}
		ev := textEvent("e1", "你好吗")
		ev.FromUser = false
		if err := e.svc.HandleEvent(context.Background(), ev, e.deadline()); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(e.msg.replies) != 0 || len(e.msg.pushes) != 0 || len(e.store.calls) != 0 || len(e.gen.calls) != 0 {
			t.Errorf("%s: group event had effects: replies=%v calls=%v gen=%v", name, e.msg.replies, e.store.calls, e.gen.calls)
		}
		// A group event carrying a link code must not link either.
		e.putCode(testOwner, "member", "ABCD2345", t0.Add(5*time.Minute))
		ev.Text = "ABCD2345"
		if err := e.svc.HandleEvent(context.Background(), ev, e.deadline()); err != nil {
			t.Fatal(err)
		}
		if len(e.store.calls) != 0 || len(e.msg.replies) != 0 {
			t.Errorf("%s: group link code had effects: %v", name, e.store.calls)
		}
	}
}

func TestLinkedNonTextGetsUsage(t *testing.T) {
	e := newEnv(t)
	e.link()
	ev := line.Event{WebhookEventID: "e1", ReplyToken: "t", UserID: testLineUser, FromUser: true}
	if err := e.svc.HandleEvent(context.Background(), ev, e.deadline()); err != nil {
		t.Fatal(err)
	}
	if got := e.onlyReply(t); got != line.MsgUsage {
		t.Errorf("reply = %q, want MsgUsage", got)
	}
	if len(e.gen.calls) != 0 || e.store.called("InsertLineMessage") {
		t.Error("non-text must not be processed")
	}
}

func TestUnsupportedTextGetsUsage(t *testing.T) {
	e := newEnv(t)
	e.link()
	for _, text := range []string{"hello world", "   ", "12345"} {
		e.msg.replies = nil
		if err := e.svc.HandleEvent(context.Background(), textEvent("e-"+text, text), e.deadline()); err != nil {
			t.Fatal(err)
		}
		if got := e.onlyReply(t); got != line.MsgUsage {
			t.Errorf("%q: reply = %q, want MsgUsage", text, got)
		}
	}
	if len(e.gen.calls) != 0 || e.store.called("InsertLineMessage") {
		t.Error("unsupported text must not be processed")
	}
}

func TestInvalidOwnerDeletesLink(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.valid = false
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好吗"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if got := e.onlyReply(t); got != line.MsgLinkGone {
		t.Errorf("reply = %q, want MsgLinkGone", got)
	}
	if len(e.store.links) != 0 {
		t.Errorf("link not deleted: %v", e.store.links)
	}
	if len(e.gen.calls) != 0 || e.store.called("InsertLineMessage") {
		t.Error("an invalid owner must not reach generation")
	}
}

func TestOwnerCheckReceivesLinkOwnerAndRole(t *testing.T) {
	e := newEnv(t)
	e.store.links[testLineUser] = store.LineLink{LineUserID: testLineUser, OwnerID: "12345", Role: "admin"}
	var gotOwner, gotRole string
	e.svc.OwnerValid = func(_ context.Context, owner, role string) (bool, error) {
		gotOwner, gotRole = owner, role
		return true, nil
	}
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好吗"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if gotOwner != "12345" || gotRole != "admin" {
		t.Errorf("OwnerValid(%q, %q)", gotOwner, gotRole)
	}
}

func TestOwnerCheckError(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.svc.OwnerValid = func(context.Context, string, string) (bool, error) { return false, errBoom }
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好吗"), e.deadline()); !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want errBoom", err)
	}
	if len(e.store.links) != 1 {
		t.Error("a failed check must not delete the link")
	}
	if len(e.gen.calls) != 0 {
		t.Error("generator called")
	}
}

func TestCorrectionSuccess(t *testing.T) {
	e := newEnv(t)
	e.link()
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "  你好马？\n"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 1 || e.gen.calls[0] != (genCall{learning.KindCorrection, "你好马？"}) {
		t.Fatalf("generate calls = %v", e.gen.calls)
	}
	if len(e.store.entries) != 1 {
		t.Fatalf("entries = %v", e.store.entries)
	}
	d := e.store.entries[0]
	if d.Kind != "correction" || d.OriginalText != "你好马？" || d.CorrectedText != "你好吗？" || d.Pinyin != "nǐ hǎo ma?" || len(d.Hints) != 1 || d.Hints[0] != "吗 は疑問" {
		t.Errorf("draft = %+v", d)
	}
	m := e.store.messages[0]
	if m.Status != store.LineStatusDone || m.Text != "" || m.Attempts != 1 {
		t.Errorf("message = %+v", m)
	}
	if m.WebhookEventID != "e1" || m.LineUserID != testLineUser || m.OwnerID != testOwner || m.Kind != "correction" {
		t.Errorf("stored message = %+v", m)
	}
	want := line.FormatResult("correction", "你好马？", "你好吗？", "nǐ hǎo ma?", []string{"吗 は疑問"})
	if got := e.onlyReply(t); got != want {
		t.Errorf("reply = %q, want %q", got, want)
	}
	if e.msg.tokens[0] != "tok-e1" {
		t.Errorf("reply token = %q", e.msg.tokens[0])
	}
	if len(e.msg.pushes) != 0 {
		t.Error("webhook path must reply, not push")
	}
}

func TestTranslationSuccess(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.gen.result = learning.Result{Text: "我想吃饭。", Pinyin: "wǒ xiǎng chī fàn.", Hints: []string{"想 = したい"}}
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "ご飯が食べたい"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if e.gen.calls[0] != (genCall{learning.KindTranslation, "ご飯が食べたい"}) {
		t.Fatalf("generate calls = %v", e.gen.calls)
	}
	d := e.store.entries[0]
	if d.Kind != "translation" || d.OriginalText != "ご飯が食べたい" || d.CorrectedText != "我想吃饭。" {
		t.Errorf("draft = %+v", d)
	}
	want := line.FormatResult("translation", "ご飯が食べたい", "我想吃饭。", "wǒ xiǎng chī fàn.", []string{"想 = したい"})
	if got := e.onlyReply(t); got != want {
		t.Errorf("reply = %q, want %q", got, want)
	}
}

func TestRedeliveryAfterDoneDoesNothing(t *testing.T) {
	e := newEnv(t)
	e.link()
	ctx := context.Background()
	if err := e.svc.HandleEvent(ctx, textEvent("e1", "你好马？"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	e.msg.replies = nil
	if err := e.svc.HandleEvent(ctx, textEvent("e1", "你好马？"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 1 || len(e.store.entries) != 1 {
		t.Errorf("generator calls = %d, entries = %d; want 1 and 1", len(e.gen.calls), len(e.store.entries))
	}
	if len(e.msg.replies) != 0 || len(e.msg.pushes) != 0 {
		t.Error("a redelivery must not send anything")
	}
}

func TestRedeliveryWhilePendingDoesNothing(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.gen.err = &learning.Error{Code: "OPENAI_TIMEOUT", Retryable: true}
	ctx := context.Background()
	if err := e.svc.HandleEvent(ctx, textEvent("e1", "你好马？"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	e.msg.replies = nil
	if err := e.svc.HandleEvent(ctx, textEvent("e1", "你好马？"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 1 || len(e.msg.replies) != 0 {
		t.Errorf("generator calls = %d, replies = %v", len(e.gen.calls), e.msg.replies)
	}
}

func TestRetryableFailureStaysPending(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.gen.err = &learning.Error{Code: "OPENAI_TIMEOUT", Retryable: true}
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	m := e.store.messages[0]
	if m.Status != store.LineStatusPending || m.Text != "你好马？" || m.Attempts != 1 {
		t.Errorf("message = %+v, want pending with its text and one attempt", m)
	}
	if e.store.called("FailLineMessage") || e.store.called("CompleteLineMessage") {
		t.Error("retryable failure must leave the row alone")
	}
	if got := e.onlyReply(t); got != line.MsgSlow {
		t.Errorf("reply = %q, want MsgSlow", got)
	}
}

func TestTooLittleTimeLeftSavesTheMessageWithoutGenerating(t *testing.T) {
	e := newEnv(t)
	e.link()
	// 25s is below generationBudget + replyMargin (30s).
	deadline := e.clock.Now().Add(25 * time.Second)
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), deadline); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 0 {
		t.Error("generator called with too little time left")
	}
	if len(e.store.messages) != 1 {
		t.Fatalf("messages = %d, want the text saved", len(e.store.messages))
	}
	m := e.store.messages[0]
	if m.Status != store.LineStatusPending || m.Text != "你好马？" || m.Attempts != 0 {
		t.Errorf("message = %+v, want pending with its text and no attempt counted", m)
	}
	if e.store.called("StartLineMessageAttempt") || e.store.called("CompleteLineMessage") || e.store.called("FailLineMessage") {
		t.Error("the row must be left alone for the drain")
	}
	if got := e.onlyReply(t); got != line.MsgSlow {
		t.Errorf("reply = %q, want MsgSlow", got)
	}
}

func TestEnoughTimeLeftGenerates(t *testing.T) {
	e := newEnv(t)
	e.link()
	deadline := e.clock.Now().Add(31 * time.Second)
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), deadline); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 1 {
		t.Errorf("generator calls = %d, want 1", len(e.gen.calls))
	}
	if m := e.store.messages[0]; m.Status != store.LineStatusDone {
		t.Errorf("status = %q, want done", m.Status)
	}
}

func TestTooLittleTimeLeftDoesNotAffectLinking(t *testing.T) {
	e := newEnv(t)
	e.putCode(testOwner, "member", "ABCD2345", t0.Add(5*time.Minute))
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "ABCD2345"), e.clock.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if got := e.onlyReply(t); got != line.MsgLinked {
		t.Errorf("reply = %q, want MsgLinked", got)
	}
}

func TestPermanentFailureFailsRow(t *testing.T) {
	cases := map[string]error{
		"OPENAI_INVALID_RESPONSE": &learning.Error{Code: "OPENAI_INVALID_RESPONSE"},
		"OPENAI_AUTH_FAILED":      &learning.Error{Code: "OPENAI_AUTH_FAILED"},
		"OPENAI_REQUEST_FAILED":   errBoom, // not a *learning.Error
	}
	for code, genErr := range cases {
		e := newEnv(t)
		e.link()
		e.gen.err = genErr
		if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline()); err != nil {
			t.Fatal(err)
		}
		m := e.store.messages[0]
		if m.Status != store.LineStatusFailed || m.Text != "" {
			t.Errorf("%s: message = %+v", code, m)
		}
		if len(e.store.entries) != 0 {
			t.Errorf("%s: a note was saved", code)
		}
		if got, want := e.onlyReply(t), line.FormatFailure("correction", code); got != want {
			t.Errorf("%s: reply = %q, want %q", code, got, want)
		}
	}
}

func TestFailureUsesTranslationWording(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.gen.err = &learning.Error{Code: "OPENAI_RATE_LIMITED"}
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "ご飯"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if got, want := e.onlyReply(t), line.FormatFailure("translation", "OPENAI_RATE_LIMITED"); got != want {
		t.Errorf("reply = %q, want %q", got, want)
	}
}

func TestLengthLimitIsCountedInRunes(t *testing.T) {
	e := newEnv(t)
	e.link()
	ok := strings.Repeat("字", 499) + "😀" // 500 runes, well over 500 bytes
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", ok), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 1 {
		t.Fatalf("500 runes should be processed; generator calls = %d", len(e.gen.calls))
	}

	e2 := newEnv(t)
	e2.link()
	if err := e2.svc.HandleEvent(context.Background(), textEvent("e2", ok+"字"), e2.deadline()); err != nil {
		t.Fatal(err)
	}
	if got := e2.onlyReply(t); got != line.MsgTooLong {
		t.Errorf("reply = %q, want MsgTooLong", got)
	}
	if len(e2.gen.calls) != 0 || e2.store.called("InsertLineMessage") {
		t.Error("501 runes must not create a row or call the generator")
	}
}

func TestTrailingWhitespaceDoesNotCountTowardLimit(t *testing.T) {
	e := newEnv(t)
	e.link()
	text := strings.Repeat("字", 500) + "  \n"
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", text), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.gen.calls) != 1 || e.gen.calls[0].text != strings.Repeat("字", 500) {
		t.Fatalf("generator calls = %v", e.gen.calls)
	}
}

func TestMissingEventIDIsSkipped(t *testing.T) {
	e := newEnv(t)
	e.link()
	if err := e.svc.HandleEvent(context.Background(), textEvent("", "你好马？"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if e.store.called("InsertLineMessage") || len(e.gen.calls) != 0 {
		t.Error("an event without an ID cannot be deduplicated and must not be processed")
	}
}

func TestStoreErrorsPropagate(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.store.insertErr = errBoom
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline()); !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want errBoom", err)
	}
	if len(e.gen.calls) != 0 {
		t.Error("generator called after insert failure")
	}
}

func TestCompleteFailureLeavesRowPendingAndReportsSlow(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.store.completeEr = errBoom
	err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline())
	if !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want errBoom", err)
	}
	if m := e.store.messages[0]; m.Status != store.LineStatusPending {
		t.Errorf("status = %q, want pending", m.Status)
	}
	if got := e.onlyReply(t); got != line.MsgSlow {
		t.Errorf("reply = %q, want MsgSlow", got)
	}
}

func TestCompleteNotFoundSendsNothing(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.store.completeEr = store.ErrNotFound
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.msg.replies) != 0 {
		t.Errorf("replies = %v; the message was settled elsewhere", e.msg.replies)
	}
}

func TestFailLineMessageErrorSendsNoFailureReply(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.gen.err = &learning.Error{Code: "OPENAI_AUTH_FAILED"}
	e.store.failErr = errBoom
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline()); !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want errBoom", err)
	}
	if len(e.msg.replies) != 0 {
		t.Errorf("replies = %v", e.msg.replies)
	}
}

func TestReplyFailureDoesNotChangeState(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.msg.replyErr = errBoom
	err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline())
	if !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want the reply error", err)
	}
	if m := e.store.messages[0]; m.Status != store.LineStatusDone || len(e.store.entries) != 1 {
		t.Errorf("message = %+v, entries = %d; a failed reply must leave the note saved", m, len(e.store.entries))
	}
}

func TestReplyFailureOnLinking(t *testing.T) {
	e := newEnv(t)
	e.msg.replyErr = errBoom
	e.putCode(testOwner, "member", "ABCD2345", t0.Add(5*time.Minute))
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "ABCD2345"), e.deadline()); !errors.Is(err, errBoom) {
		t.Fatalf("err = %v", err)
	}
	if _, ok := e.store.links[testLineUser]; !ok {
		t.Error("the link must stay even when the reply fails")
	}
}

func TestPrimaryErrorWinsOverReplyError(t *testing.T) {
	e := newEnv(t)
	e.link()
	e.store.completeEr = errBoom
	e.msg.replyErr = errors.New("reply broke")
	err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline())
	if !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want the store error", err)
	}
}

func TestLogsNeverContainSensitiveValues(t *testing.T) {
	const secretText = "秘密の文章を添削してください机密文本"
	const secretResult = "SECRETRESULT结果"
	const secretReplyErr = "token-in-error"
	ctx := context.Background()

	// A mix of flows that log: reply failure, permanent failure, retryable
	// failure, completion not found, bad link code, relink.
	run := func(setup func(*env), text string) *env {
		e := newEnv(t)
		e.link()
		e.gen.result = learning.Result{Text: secretResult, Pinyin: secretResult, Hints: []string{secretResult}}
		setup(e)
		_ = e.svc.HandleEvent(ctx, textEvent("event-1", text), e.deadline())
		return e
	}
	envs := []*env{
		run(func(e *env) { e.msg.replyErr = errors.New(secretReplyErr + testLineUser) }, secretText),
		run(func(e *env) { e.gen.err = &learning.Error{Code: "OPENAI_AUTH_FAILED"} }, secretText),
		run(func(e *env) { e.gen.err = &learning.Error{Code: "OPENAI_TIMEOUT", Retryable: true} }, secretText),
		run(func(e *env) { e.store.completeEr = store.ErrNotFound }, secretText),
		run(func(e *env) {
			e.store.completeEr = errors.New("db: " + secretText)
			e.msg.replyErr = errors.New("line: " + testLineUser)
		}, secretText),
		run(func(e *env) { e.msg.replyErr = errors.New("x") }, "ZZZZ2345"),
		run(func(e *env) { e.valid = false; e.msg.replyErr = errors.New("x") }, secretText),
	}
	for i, e := range envs {
		out := e.logs.String()
		for _, secret := range []string{secretText, secretResult, secretReplyErr, testLineUser, "ZZZZ2345", "tok-event-1"} {
			if strings.Contains(out, secret) {
				t.Errorf("flow %d: log contains %q:\n%s", i, secret, out)
			}
		}
	}
	// The log must still say something useful for the failing flows.
	if out := envs[0].logs.String(); !strings.Contains(out, "event-1") {
		t.Errorf("reply failure log lacks the event ID: %q", out)
	}
	if out := envs[1].logs.String(); !strings.Contains(out, "OPENAI_AUTH_FAILED") {
		t.Errorf("failure log lacks the code: %q", out)
	}
}
