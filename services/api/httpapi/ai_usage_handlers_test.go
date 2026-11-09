package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/aiusage"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/learning"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type fakeAIUsage struct {
	rows        []store.AIUsage
	at          []time.Time
	recordErr   error
	year, month int
	totals      []store.AIUsageTotal
}

func (f *fakeAIUsage) RecordAIUsage(ctx context.Context, u store.AIUsage, now time.Time) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if f.recordErr != nil {
		return f.recordErr
	}
	f.rows = append(f.rows, u)
	f.at = append(f.at, now)
	return nil
}

func (f *fakeAIUsage) AIUsageMonth(_ context.Context, year, month int) ([]store.AIUsageTotal, error) {
	f.year, f.month = year, month
	return f.totals, nil
}

func TestAIUsageSummaryIsAdminOnly(t *testing.T) {
	for _, role := range []string{auth.RoleMember, auth.RoleGuest} {
		h, _, _ := routerWith(t, role, Deps{AIUsage: &fakeAIUsage{}})
		wantError(t, do(h, "GET", "/v1/admin/ai-usage", "", authHeader), http.StatusForbidden, "forbidden")
	}
}

func TestAIUsageSummaryRouteNeedsTheStore(t *testing.T) {
	h, _, _ := routerWith(t, auth.RoleAdmin, Deps{})
	wantError(t, do(h, "GET", "/v1/admin/ai-usage", "", authHeader), http.StatusNotFound, "not_found")
}

func TestAIUsageSummaryOfAMonth(t *testing.T) {
	u := &fakeAIUsage{totals: []store.AIUsageTotal{{
		OwnerID: "password:a", DisplayName: "花子", Feature: aiusage.FeatureLine, Model: "gpt-5-mini",
		Requests: 3, InputTokens: 300, OutputTokens: 120,
	}}}
	h, _, _ := routerWith(t, auth.RoleAdmin, Deps{AIUsage: u})

	w := do(h, "GET", "/v1/admin/ai-usage?month=2026-09", "", authHeader)
	if w.Code != http.StatusOK || u.year != 2026 || u.month != 9 {
		t.Fatalf("status %d, month %d-%d, body %s", w.Code, u.year, u.month, w.Body)
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := `{"month":"2026-09","totals":[{"ownerId":"password:a","displayName":"花子","feature":"line","model":"gpt-5-mini","requests":3,"inputTokens":300,"outputTokens":120}]}`
	if strings.TrimSpace(w.Body.String()) != want {
		t.Errorf("body = %s\nwant   %s", w.Body, want)
	}
}

func TestAIUsageSummaryDefaultsToTheJSTMonth(t *testing.T) {
	u := &fakeAIUsage{}
	h, clk, _ := routerWith(t, auth.RoleAdmin, Deps{AIUsage: u})
	// 2026-10-31 15:00 UTC is already November in Japan.
	clk.t = time.Date(2026, 10, 31, 15, 0, 0, 0, time.UTC)
	w := do(h, "GET", "/v1/admin/ai-usage", "", authHeader)
	if w.Code != http.StatusOK || u.year != 2026 || u.month != 11 || !strings.Contains(w.Body.String(), `"month":"2026-11"`) ||
		!strings.Contains(w.Body.String(), `"totals":[]`) {
		t.Fatalf("status %d, month %d-%d, body %s", w.Code, u.year, u.month, w.Body)
	}
}

func TestAIUsageSummaryRejectsABadMonth(t *testing.T) {
	h, _, _ := routerWith(t, auth.RoleAdmin, Deps{AIUsage: &fakeAIUsage{}})
	for _, m := range []string{"2026-13", "2026-00", "2026-1", "202611", "1999-12", "x"} {
		wantError(t, do(h, "GET", "/v1/admin/ai-usage?month="+m, "", authHeader), http.StatusBadRequest, "invalid_request")
	}
}

func TestChatRecordsUsageForTheCaller(t *testing.T) {
	u := &fakeAIUsage{}
	h, clk, _ := routerWith(t, auth.RoleMember, Deps{Chat: &fakeChat{pieces: []string{"好"}}, Conversations: &fakeConversations{}, AIUsage: u})
	w := do(h, "POST", "/v1/chat", `{"messages":[{"role":"user","text":"你好"}]}`, jsonAuth)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	want := store.AIUsage{OwnerID: testOwner, Feature: aiusage.FeatureChat, Model: "gpt-chat", InputTokens: 40, OutputTokens: 60}
	if len(u.rows) != 1 || u.rows[0] != want || !u.at[0].Equal(clk.t) {
		t.Fatalf("usage = %+v at %v, want [%+v]", u.rows, u.at, want)
	}
}

func TestQuickQuestionAndDraftRecordTheirFeature(t *testing.T) {
	u := &fakeAIUsage{}
	h, _, _ := routerWith(t, auth.RoleMember, Deps{
		QuickChat: &fakeChat{pieces: []string{"好"}}, Questions: &fakeQuestions{},
		VocabularyDrafter: &reportingDrafter{}, AIUsage: u,
	})
	do(h, "POST", "/v1/quick-question", `{"messages":[{"role":"user","text":"你好"}]}`, jsonAuth)
	do(h, "POST", "/v1/vocabulary/draft", `{"word":"认真"}`, jsonAuth)
	if len(u.rows) != 2 || u.rows[0].Feature != aiusage.FeatureQuickQuestion || u.rows[1].Feature != aiusage.FeatureVocabularyDraft {
		t.Fatalf("usage = %+v", u.rows)
	}
}

func TestActingAdminPaysForTheUsage(t *testing.T) {
	u := &fakeAIUsage{}
	a := &fakeAuth{authenticate: func(context.Context, string) (auth.Principal, error) {
		return auth.Principal{OwnerID: testOwner, Role: auth.RoleAdmin, ActorID: "12345"}, nil
	}}
	h, _, _ := routerWith(t, "", Deps{Auth: a, Chat: &fakeChat{pieces: []string{"好"}}, Conversations: &fakeConversations{}, AIUsage: u})
	do(h, "POST", "/v1/chat", `{"messages":[{"role":"user","text":"你好"}]}`, jsonAuth)
	if len(u.rows) != 1 || u.rows[0].OwnerID != "12345" {
		t.Fatalf("usage = %+v, want it on the admin 12345", u.rows)
	}
}

func TestUsageFailureDoesNotBreakTheAnswer(t *testing.T) {
	u := &fakeAIUsage{recordErr: errors.New("db down")}
	h, _, logs := routerWith(t, auth.RoleMember, Deps{Chat: &fakeChat{pieces: []string{"好"}}, Conversations: &fakeConversations{}, AIUsage: u})
	w := do(h, "POST", "/v1/chat", `{"messages":[{"role":"user","text":"你好"}]}`, jsonAuth)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"done"`) {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if !strings.Contains(logs.String(), "ai usage not recorded") {
		t.Errorf("logs = %s, want the failed record logged", logs)
	}
}

// reportingDrafter is a VocabularyDrafter that reports usage like OpenAI.
type reportingDrafter struct{ fakeDrafter }

func (r *reportingDrafter) DraftVocabulary(ctx context.Context, word, sentence string) (learning.VocabularyDraft, error) {
	aiusage.Report(ctx, aiusage.Usage{Model: "gpt-5-mini", InputTokens: 5, OutputTokens: 6})
	return r.fakeDrafter.DraftVocabulary(ctx, word, sentence)
}
