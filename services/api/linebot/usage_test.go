package linebot

import (
	"context"
	"errors"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/aiusage"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

func TestGenerationRecordsUsageForTheOwner(t *testing.T) {
	e := newEnv(t)
	usage := &fakeUsage{}
	e.svc.Usage = usage
	e.link()
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	want := store.AIUsage{OwnerID: testOwner, Feature: aiusage.FeatureLine, Model: "gpt-test", InputTokens: 11, OutputTokens: 22}
	if len(usage.rows) != 1 || usage.rows[0] != want {
		t.Fatalf("usage = %+v, want [%+v]", usage.rows, want)
	}
}

func TestUsageFailureDoesNotStopTheMessage(t *testing.T) {
	e := newEnv(t)
	e.svc.Usage = &fakeUsage{err: errors.New("db down")}
	e.link()
	if err := e.svc.HandleEvent(context.Background(), textEvent("e1", "你好马？"), e.deadline()); err != nil {
		t.Fatal(err)
	}
	if len(e.store.entries) != 1 {
		t.Fatalf("entries = %v, want the note saved anyway", e.store.entries)
	}
}
