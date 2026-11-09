package httpapi

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/aiusage"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// AIUsage is what the handlers need from *store.Store to record and sum up
// the tokens OpenAI calls use.
type AIUsage interface {
	RecordAIUsage(ctx context.Context, u store.AIUsage, now time.Time) error
	AIUsageMonth(ctx context.Context, year, month int) ([]store.AIUsageTotal, error)
}

var _ AIUsage = (*store.Store)(nil)

// recordTimeout bounds saving one usage row. The row is saved even when the
// client has gone (a stopped chat still used its tokens).
const recordTimeout = 5 * time.Second

// trackAIUsage records every OpenAI call h makes as feature, for the person
// who made the request: the admin, while an admin acts as a member. A nil
// usage serves h as it is.
func trackAIUsage(usage AIUsage, feature string, now func() time.Time, h http.Handler) http.Handler {
	if usage == nil {
		return h
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := principalFrom(r.Context())
		owner := p.OwnerID
		if p.ActorID != "" {
			owner = p.ActorID
		}
		rec := func(ctx context.Context, u aiusage.Usage) {
			ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), recordTimeout)
			defer cancel()
			err := usage.RecordAIUsage(ctx, store.AIUsage{
				OwnerID: owner, Feature: feature, Model: u.Model,
				InputTokens: u.InputTokens, OutputTokens: u.OutputTokens,
			}, now())
			if err != nil {
				loggerFrom(r.Context()).Warn("ai usage not recorded", "feature", feature, "error", err.Error())
			}
		}
		h.ServeHTTP(w, r.WithContext(aiusage.WithRecorder(r.Context(), rec)))
	})
}

var monthPattern = regexp.MustCompile(`^(\d{4})-(\d{2})$`)

// parseMonth reads "YYYY-MM"; an empty string is the JST month of now.
func parseMonth(s string, now time.Time) (year, month int, ok bool) {
	if s == "" {
		t := now.In(time.FixedZone("JST", 9*3600))
		return t.Year(), int(t.Month()), true
	}
	m := monthPattern.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, false
	}
	year, _ = strconv.Atoi(m[1])
	month, _ = strconv.Atoi(m[2])
	if year < 2000 || month < 1 || month > 12 {
		return 0, 0, false
	}
	return year, month, true
}

// aiUsageMonth answers the admin's monthly summary of OpenAI usage.
func aiUsageMonth(usage AIUsage, now func() time.Time) http.Handler {
	type total struct {
		OwnerID      string `json:"ownerId"`
		DisplayName  string `json:"displayName"`
		Feature      string `json:"feature"`
		Model        string `json:"model"`
		Requests     int    `json:"requests"`
		InputTokens  int64  `json:"inputTokens"`
		OutputTokens int64  `json:"outputTokens"`
	}
	type response struct {
		Month  string  `json:"month"`
		Totals []total `json:"totals"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		year, month, ok := parseMonth(r.URL.Query().Get("month"), now())
		if !ok {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgInvalidMonth)
			return
		}
		totals, err := usage.AIUsageMonth(r.Context(), year, month)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{Month: strconv.Itoa(year) + "-" + twoDigits(month), Totals: make([]total, len(totals))}
		for i, t := range totals {
			out.Totals[i] = total{
				OwnerID: t.OwnerID, DisplayName: t.DisplayName, Feature: t.Feature, Model: t.Model,
				Requests: t.Requests, InputTokens: t.InputTokens, OutputTokens: t.OutputTokens,
			}
		}
		writeJSON(w, http.StatusOK, out)
	})
}

func twoDigits(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}
