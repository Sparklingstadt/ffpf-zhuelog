package aiusage

import (
	"context"
	"testing"
)

func TestReportWithoutRecorderDoesNothing(t *testing.T) {
	Report(context.Background(), Usage{Model: "m", InputTokens: 1}) // must not panic
	if ctx := WithRecorder(context.Background(), nil); ctx != context.Background() {
		t.Fatal("WithRecorder(nil) changed the context")
	}
}

func TestReportReachesRecorderThroughDerivedContexts(t *testing.T) {
	var got []Usage
	ctx := WithRecorder(context.Background(), func(_ context.Context, u Usage) { got = append(got, u) })
	child, cancel := context.WithCancel(ctx)
	defer cancel()

	Report(child, Usage{Model: "gpt", InputTokens: 12, OutputTokens: 34})
	Report(child, Usage{Model: "gpt", InputTokens: -1, OutputTokens: -2})

	want := []Usage{{"gpt", 12, 34}, {"gpt", 0, 0}}
	if len(got) != len(want) {
		t.Fatalf("got %d reports, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("report %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
