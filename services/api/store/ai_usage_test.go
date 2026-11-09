package store

import (
	"context"
	"testing"
	"time"
)

// aiUsageOwner is a new owner whose usage rows are removed after the test.
func aiUsageOwner(t *testing.T, owner string) {
	t.Helper()
	t.Cleanup(func() {
		s := testStore(t)
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "AiUsage" WHERE "ownerId" = $1`, owner)
	})
}

func onlyOwners(totals []AIUsageTotal, owners ...string) []AIUsageTotal {
	keep := map[string]bool{}
	for _, o := range owners {
		keep[o] = true
	}
	var out []AIUsageTotal
	for _, t := range totals {
		if keep[t.OwnerID] {
			out = append(out, t)
		}
	}
	return out
}

func TestAIUsageMonthAddsUpByOwnerFeatureAndModel(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	member := newMember(t, s)
	admin := "github:" + newID()
	aiUsageOwner(t, member)
	aiUsageOwner(t, admin)

	// 2026-11-01 00:00 JST is 2026-10-31 15:00 UTC.
	inMonth := time.Date(2026, 10, 31, 15, 0, 0, 0, time.UTC)
	beforeMonth := inMonth.Add(-time.Millisecond)
	nextMonth := time.Date(2026, 11, 30, 15, 0, 0, 0, time.UTC)
	record := func(owner, feature, model string, in, out int, at time.Time) {
		t.Helper()
		if err := s.RecordAIUsage(ctx, AIUsage{OwnerID: owner, Feature: feature, Model: model, InputTokens: in, OutputTokens: out}, at); err != nil {
			t.Fatal(err)
		}
	}
	record(member, "line", "gpt-5-mini", 100, 50, inMonth)
	record(member, "line", "gpt-5-mini", 200, 60, nextMonth.Add(-time.Millisecond))
	record(member, "chat", "gpt-5", 10, 5, inMonth)
	record(member, "line", "gpt-5-mini", 9999, 9999, beforeMonth)
	record(member, "line", "gpt-5-mini", 9999, 9999, nextMonth)
	record(admin, "chat", "gpt-5", 5000, 1000, inMonth)

	all, err := s.AIUsageMonth(ctx, 2026, 11)
	if err != nil {
		t.Fatal(err)
	}
	got := onlyOwners(all, member, admin)
	if len(got) != 3 {
		t.Fatalf("totals = %+v, want 3 rows", got)
	}
	// The admin used more tokens, so comes first, with no display name.
	if a := got[0]; a.OwnerID != admin || a.DisplayName != "" || a.Feature != "chat" || a.Requests != 1 || a.InputTokens != 5000 {
		t.Errorf("admin row = %+v", a)
	}
	if c := got[1]; c.OwnerID != member || c.Feature != "chat" || c.Model != "gpt-5" || c.Requests != 1 || c.DisplayName == "" {
		t.Errorf("member chat row = %+v", c)
	}
	if l := got[2]; l.Feature != "line" || l.Requests != 2 || l.InputTokens != 300 || l.OutputTokens != 110 {
		t.Errorf("member line row = %+v", l)
	}

	other, err := s.AIUsageMonth(ctx, 2026, 9)
	if err != nil || len(onlyOwners(other, member, admin)) != 0 {
		t.Fatalf("september = %+v, %v; want nothing of these owners", other, err)
	}
}
