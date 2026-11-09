package learning

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/aiusage"
)

// withUsage adds a "usage" object to a Responses API body.
func withUsage(t *testing.T, body string, in, out int) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(body), &m); err != nil {
		t.Fatal(err)
	}
	m["usage"] = map[string]any{"input_tokens": in, "output_tokens": out, "total_tokens": in + out}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func recording() (context.Context, *[]aiusage.Usage) {
	var got []aiusage.Usage
	ctx := aiusage.WithRecorder(context.Background(), func(_ context.Context, u aiusage.Usage) { got = append(got, u) })
	return ctx, &got
}

func TestGenerateReportsUsage(t *testing.T) {
	o, _ := serve(t, http.StatusOK, withUsage(t, outputBody(t, validJSON("correctedText")), 321, 54))
	ctx, got := recording()
	if _, err := o.Generate(ctx, KindCorrection, testText); err != nil {
		t.Fatal(err)
	}
	want := aiusage.Usage{Model: "gpt-5-mini", InputTokens: 321, OutputTokens: 54}
	if len(*got) != 1 || (*got)[0] != want {
		t.Fatalf("reports = %+v, want [%+v]", *got, want)
	}
}

func TestUnusableAnswerStillReportsUsage(t *testing.T) {
	o, _ := serve(t, http.StatusOK, withUsage(t, outputBody(t, `{"nope":1}`), 10, 20))
	ctx, got := recording()
	if _, err := o.Generate(ctx, KindCorrection, testText); err == nil {
		t.Fatal("want an error for the invalid output")
	}
	if len(*got) != 1 || (*got)[0].OutputTokens != 20 {
		t.Fatalf("reports = %+v, want one with 20 output tokens", *got)
	}
}

func TestDraftVocabularyReportsUsage(t *testing.T) {
	o, _ := serve(t, http.StatusOK, withUsage(t, outputBody(t, `{"pinyin":"xuéxí","meaning":"学ぶ"}`), 7, 8))
	ctx, got := recording()
	if _, err := o.DraftVocabulary(ctx, "学习", ""); err != nil {
		t.Fatal(err)
	}
	if len(*got) != 1 || (*got)[0].InputTokens != 7 || (*got)[0].OutputTokens != 8 {
		t.Fatalf("reports = %+v", *got)
	}
}

func TestNoUsageAndErrorStatusesReportNothing(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
	}{
		{http.StatusOK, ""},
		{http.StatusInternalServerError, `{"usage":{"input_tokens":1,"output_tokens":1}}`},
	} {
		body := tc.body
		if body == "" {
			body = outputBody(t, validJSON("correctedText"))
		}
		o, _ := serve(t, tc.status, body)
		ctx, got := recording()
		_, _ = o.Generate(ctx, KindCorrection, testText)
		if len(*got) != 0 {
			t.Errorf("status %d: reports = %+v, want none", tc.status, *got)
		}
	}
}
