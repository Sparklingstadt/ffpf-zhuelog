package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

func TestLogDatesHandler(t *testing.T) {
	var owner string
	h := roleEntriesRouter(t, &fakeEntries{logDates: func(_ context.Context, o string) ([]store.LogDateCount, error) {
		owner = o
		return []store.LogDateCount{{Date: store.LogDate{Year: 2026, Month: 4, Day: 10}, Count: 3}, {Date: store.LogDate{Year: 2026, Month: 1, Day: 5}, Count: 1}}, nil
	}}, auth.RoleMember)
	w := do(h, "GET", "/v1/log-dates", "", authHeader)
	if w.Code != 200 || owner != testOwner {
		t.Fatalf("code %d owner %q", w.Code, owner)
	}
	var got struct {
		Dates []struct {
			Date  string `json:"date"`
			Count int    `json:"count"`
		} `json:"dates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Dates) != 2 || got.Dates[0].Date != "2026-04-10" || got.Dates[0].Count != 3 || got.Dates[1].Date != "2026-01-05" {
		t.Fatalf("got %+v", got)
	}
	// empty list is [] not null
	h = roleEntriesRouter(t, &fakeEntries{logDates: func(context.Context, string) ([]store.LogDateCount, error) { return nil, nil }}, auth.RoleMember)
	if b := do(h, "GET", "/v1/log-dates", "", authHeader).Body.String(); b != `{"dates":[]}` {
		t.Fatalf("body %s", b)
	}
	// admin ?user=
	h = roleEntriesRouter(t, &fakeEntries{logDates: func(_ context.Context, o string) ([]store.LogDateCount, error) {
		owner = o
		return nil, nil
	}}, auth.RoleAdmin)
	do(h, "GET", "/v1/log-dates?user="+otherOwner, "", authHeader)
	if owner != otherOwner {
		t.Fatalf("owner %q", owner)
	}
	hm := roleEntriesRouter(t, &fakeEntries{}, auth.RoleMember)
	wantError(t, do(hm, "GET", "/v1/log-dates?user="+otherOwner, "", authHeader), 403, "forbidden")
}

func TestDailyEntriesHandler(t *testing.T) {
	now := newClock().Now()
	var gotDate store.LogDate
	h := roleEntriesRouter(t, &fakeEntries{dailyEntries: func(_ context.Context, o string, d store.LogDate) ([]store.Entry, error) {
		gotDate = d
		return []store.Entry{sampleEntry("a", now), sampleEntry("b", now.Add(time.Minute))}, nil
	}}, auth.RoleMember)
	w := do(h, "GET", "/v1/log-dates/2026-04-10/entries", "", authHeader)
	if w.Code != 200 || gotDate != (store.LogDate{Year: 2026, Month: 4, Day: 10}) {
		t.Fatalf("code %d date %+v", w.Code, gotDate)
	}
	var got struct {
		Date    string `json:"date"`
		Entries []struct {
			ID     string `json:"id"`
			Number int    `json:"number"`
			Kind   string `json:"kind"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Date != "2026-04-10" || len(got.Entries) != 2 || got.Entries[0].ID != "a" || got.Entries[0].Number != 1 || got.Entries[1].Number != 2 || got.Entries[1].Kind != "correction" {
		t.Fatalf("got %+v", got)
	}
	h = roleEntriesRouter(t, &fakeEntries{dailyEntries: func(context.Context, string, store.LogDate) ([]store.Entry, error) { return nil, nil }}, auth.RoleMember)
	if b := do(h, "GET", "/v1/log-dates/2026-04-10/entries", "", authHeader).Body.String(); b != `{"date":"2026-04-10","entries":[]}` {
		t.Fatalf("body %s", b)
	}
}

func TestDailyEntryHandler(t *testing.T) {
	now := newClock().Now()
	var gotN int
	var owner string
	h := roleEntriesRouter(t, &fakeEntries{dailyEntry: func(_ context.Context, o string, d store.LogDate, n int) (store.Entry, int, error) {
		gotN, owner = n, o
		if n > 3 {
			return store.Entry{}, 0, store.ErrNotFound
		}
		return sampleEntry("e", now), 3, nil
	}}, auth.RoleAdmin)
	w := do(h, "GET", "/v1/log-dates/2026-04-10/entries/2?user="+otherOwner, "", authHeader)
	if w.Code != 200 || gotN != 2 || owner != otherOwner {
		t.Fatalf("code %d n %d owner %q", w.Code, gotN, owner)
	}
	var got struct {
		Entry  struct{ ID string } `json:"entry"`
		Number int                 `json:"number"`
		Total  int                 `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Entry.ID != "e" || got.Number != 2 || got.Total != 3 {
		t.Fatalf("got %+v", got)
	}
	wantError(t, do(h, "GET", "/v1/log-dates/2026-04-10/entries/4", "", authHeader), 404, "not_found")
	if w := do(h, "GET", "/v1/log-dates/2026-04-10/entries/2147483647", "", authHeader); w.Code != 404 {
		t.Fatalf("max number code %d", w.Code)
	}
}

func TestDailyBadParams(t *testing.T) {
	h := roleEntriesRouter(t, &fakeEntries{}, auth.RoleMember)
	for _, d := range []string{"2026-02-30", "1999-01-01", "2026-1-5", "abc", "2026-04-10x", "10000-01-01", "2026-04-1"} {
		wantError(t, do(h, "GET", "/v1/log-dates/"+d+"/entries", "", authHeader), 400, "invalid_request")
		wantError(t, do(h, "GET", "/v1/log-dates/"+d+"/entries/1", "", authHeader), 400, "invalid_request")
	}
	for _, n := range []string{"0", "01", "-1", "x", "2147483648", "+1", "1.0", "99999999999999999999"} {
		wantError(t, do(h, "GET", "/v1/log-dates/2026-04-10/entries/"+n, "", authHeader), 400, "invalid_request")
	}
	// leap day is valid
	h2 := roleEntriesRouter(t, &fakeEntries{dailyEntries: func(context.Context, string, store.LogDate) ([]store.Entry, error) { return nil, nil }}, auth.RoleMember)
	if w := do(h2, "GET", "/v1/log-dates/2024-02-29/entries", "", authHeader); w.Code != http.StatusOK {
		t.Fatalf("leap day code %d", w.Code)
	}
}

func TestDailyRoutesRequireAuth(t *testing.T) {
	h := roleEntriesRouter(t, &fakeEntries{}, auth.RoleMember)
	for _, p := range []string{"/v1/log-dates", "/v1/log-dates/2026-04-10/entries", "/v1/log-dates/2026-04-10/entries/1"} {
		wantError(t, do(h, "GET", p, "", nil), 401, "unauthorized")
	}
}

func TestDailyEntriesUserParam(t *testing.T) {
	var owner string
	f := &fakeEntries{dailyEntries: func(_ context.Context, o string, _ store.LogDate) ([]store.Entry, error) {
		owner = o
		return nil, nil
	}}
	if w := do(roleEntriesRouter(t, f, auth.RoleAdmin), "GET", "/v1/log-dates/2026-04-10/entries?user="+otherOwner, "", authHeader); w.Code != 200 || owner != otherOwner {
		t.Fatalf("admin: code %d owner %q", w.Code, owner)
	}
	owner = ""
	wantError(t, do(roleEntriesRouter(t, f, auth.RoleMember), "GET", "/v1/log-dates/2026-04-10/entries?user="+otherOwner, "", authHeader), 403, "forbidden")
	if owner != "" {
		t.Fatal("store called for forbidden member")
	}
}
