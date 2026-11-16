package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/aiusage"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type fakeAIUsage struct {
	year, month int
	totals      []store.AIUsageTotal
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
