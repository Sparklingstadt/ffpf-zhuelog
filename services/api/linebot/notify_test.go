package linebot

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

func notifyEnv(t *testing.T, quota line.Quota, targets ...store.ReviewNotifyTarget) (*env, *fakeQuota) {
	t.Helper()
	e := newEnv(t)
	q := &fakeQuota{quota: quota}
	e.svc.Quota = q
	e.store.notify().targets = targets
	return e, q
}

func target(user, owner string, due int) store.ReviewNotifyTarget {
	return store.ReviewNotifyTarget{LineUserID: user, OwnerID: owner, Role: "member", Due: due}
}

func TestNotifyPushesOneMessagePerTarget(t *testing.T) {
	e, _ := notifyEnv(t, line.Quota{Remaining: 200}, target("U1", "o1", 3), target("U2", "o2", 1))
	if err := e.svc.NotifyDueReviews(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.msg.pushes) != 2 || e.msg.pushTo[0] != "U1" || e.msg.pushTo[1] != "U2" {
		t.Fatalf("pushes to %v", e.msg.pushTo)
	}
	if got := e.msg.pushes[0][0]; got != line.FormatReviewReminder(3) || !strings.Contains(got, "3 問") || !strings.Contains(got, "/review") {
		t.Errorf("message = %q", got)
	}
	if !e.store.notify().listedAt[0].Equal(t0) {
		t.Errorf("listed at %v, want now", e.store.notify().listedAt[0])
	}

	// A second run the same day finds the claims taken and sends nothing.
	if err := e.svc.NotifyDueReviews(context.Background(), e.deadline()); err != nil || len(e.msg.pushes) != 2 {
		t.Fatalf("second run: %v, pushes %d", err, len(e.msg.pushes))
	}
}

func TestNotifyKeepsTheQuotaReserve(t *testing.T) {
	targets := []store.ReviewNotifyTarget{target("U1", "o1", 1), target("U2", "o2", 1), target("U3", "o3", 1)}
	e, _ := notifyEnv(t, line.Quota{Remaining: notifyPushReserve + 2}, targets...)
	if err := e.svc.NotifyDueReviews(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.msg.pushes) != 2 {
		t.Fatalf("pushes = %d, want 2 (the reserve stays)", len(e.msg.pushes))
	}
	if !strings.Contains(e.logs.String(), "limited by the push quota") {
		t.Error("the limit should be logged")
	}

	e, _ = notifyEnv(t, line.Quota{Remaining: 5}, targets...)
	_ = e.svc.NotifyDueReviews(context.Background(), e.deadline())
	if len(e.msg.pushes) != 0 || len(e.store.notify().claimed) != 0 {
		t.Fatalf("below the reserve: pushes %d, claims %d; want none", len(e.msg.pushes), len(e.store.notify().claimed))
	}

	e, _ = notifyEnv(t, line.Quota{Unlimited: true}, targets...)
	_ = e.svc.NotifyDueReviews(context.Background(), e.deadline())
	if len(e.msg.pushes) != 3 {
		t.Fatalf("unlimited: pushes %d, want 3", len(e.msg.pushes))
	}
}

func TestNotifyWithoutTargetsDoesNotAskForTheQuota(t *testing.T) {
	e, q := notifyEnv(t, line.Quota{Remaining: 200})
	if err := e.svc.NotifyDueReviews(context.Background(), e.deadline()); err != nil || q.calls != 0 {
		t.Fatalf("err %v, quota calls %d", err, q.calls)
	}
}

func TestNotifySendsNothingWithoutAQuotaReader(t *testing.T) {
	e := newEnv(t)
	e.store.notify().targets = []store.ReviewNotifyTarget{target("U1", "o1", 1)}
	if err := e.svc.NotifyDueReviews(context.Background(), e.deadline()); err != nil || len(e.msg.pushes) != 0 {
		t.Fatalf("err %v, pushes %d", err, len(e.msg.pushes))
	}
}

func TestNotifyQuotaFailureSendsNothing(t *testing.T) {
	e, q := notifyEnv(t, line.Quota{}, target("U1", "o1", 1))
	q.err = errors.New("line down")
	if err := e.svc.NotifyDueReviews(context.Background(), e.deadline()); err == nil || len(e.msg.pushes) != 0 {
		t.Fatalf("err %v, pushes %d", err, len(e.msg.pushes))
	}
}

func TestNotifySkipsInvalidOwners(t *testing.T) {
	e, _ := notifyEnv(t, line.Quota{Unlimited: true}, target("U1", "gone", 1), target("U2", "o2", 1))
	e.svc.OwnerValid = func(_ context.Context, owner, _ string) (bool, error) { return owner != "gone", nil }
	if err := e.svc.NotifyDueReviews(context.Background(), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.msg.pushTo) != 1 || e.msg.pushTo[0] != "U2" {
		t.Fatalf("pushes to %v, want only U2", e.msg.pushTo)
	}
}

func TestNotifyPushFailureIsReportedAndNotRetried(t *testing.T) {
	e, _ := notifyEnv(t, line.Quota{Unlimited: true}, target("U1", "o1", 1), target("U2", "o2", 1))
	e.msg.pushErr = errors.New("push failed")
	if err := e.svc.NotifyDueReviews(context.Background(), e.deadline()); err == nil {
		t.Fatal("want the push error")
	}
	if len(e.msg.pushes) != 2 {
		t.Fatalf("pushes = %d, want both tried", len(e.msg.pushes))
	}
	if !e.store.notify().claimed["U1"] {
		t.Error("a failed push keeps its claim, so it is not sent twice")
	}
}

func TestNotifyStopsNearTheDeadline(t *testing.T) {
	e, _ := notifyEnv(t, line.Quota{Unlimited: true}, target("U1", "o1", 1))
	if err := e.svc.NotifyDueReviews(context.Background(), t0.Add(time.Second)); err != nil || len(e.msg.pushes) != 0 {
		t.Fatalf("err %v, pushes %d", err, len(e.msg.pushes))
	}
}

func TestReviewNotifySetting(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if err := e.svc.SetReviewNotify(ctx, testOwner, true); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("without a link = %v", err)
	}
	e.link()
	if err := e.svc.SetReviewNotify(ctx, testOwner, true); err != nil {
		t.Fatal(err)
	}
	if linked, on, err := e.svc.ReviewNotify(ctx, testOwner); err != nil || !linked || !on {
		t.Fatalf("= %v %v %v", linked, on, err)
	}
}
