package httpapi

import (
	"net/http"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	minLogYear = 2000
	maxLogYear = 9999
	maxNumber  = 2147483647
)

// parseLogDate accepts only a real calendar date written exactly as
// zero-padded YYYY-MM-DD with a year in 2000..9999.
func parseLogDate(s string) (store.LogDate, bool) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil || t.Format("2006-01-02") != s || t.Year() < minLogYear || t.Year() > maxLogYear {
		return store.LogDate{}, false
	}
	return store.LogDate{Year: t.Year(), Month: int(t.Month()), Day: t.Day()}, true
}

func formatLogDate(d store.LogDate) string {
	return time.Date(d.Year, time.Month(d.Month), d.Day, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
}

// parseNumber accepts base-10 digits only, in 1..2147483647.
func parseNumber(s string) (int, bool) {
	if s == "" || s[0] == '0' {
		return 0, false
	}
	return decimalUpTo(s, maxNumber)
}

func listLogDates(e Entries) http.Handler {
	type dateJSON struct {
		Date  string `json:"date"`
		Count int    `json:"count"`
	}
	type response struct {
		Dates []dateJSON `json:"dates"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		owner, ok := readOwner(w, r)
		if !ok {
			return
		}
		dates, err := e.ListLogDates(r.Context(), owner)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		resp := response{Dates: make([]dateJSON, len(dates))}
		for i, d := range dates {
			resp.Dates[i] = dateJSON{Date: formatLogDate(d.Date), Count: d.Count}
		}
		writeJSON(w, http.StatusOK, resp)
	})
}

type numberedEntryJSON struct {
	entryJSON
	Number int `json:"number"`
}

func listDailyEntries(e Entries) http.Handler {
	type response struct {
		Date    string              `json:"date"`
		Entries []numberedEntryJSON `json:"entries"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := r.PathValue("date")
		d, ok := parseLogDate(raw)
		if !ok {
			writeBadRequest(w)
			return
		}
		owner, ok := readOwner(w, r)
		if !ok {
			return
		}
		entries, err := e.ListDailyEntries(r.Context(), owner, d)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		resp := response{Date: raw, Entries: make([]numberedEntryJSON, len(entries))}
		for i, en := range entries {
			resp.Entries[i] = numberedEntryJSON{entryJSON: toEntryJSON(en), Number: i + 1}
		}
		writeJSON(w, http.StatusOK, resp)
	})
}

func getDailyEntry(e Entries) http.Handler {
	type response struct {
		Entry  entryJSON `json:"entry"`
		Number int       `json:"number"`
		Total  int       `json:"total"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d, ok := parseLogDate(r.PathValue("date"))
		if !ok {
			writeBadRequest(w)
			return
		}
		n, ok := parseNumber(r.PathValue("number"))
		if !ok {
			writeBadRequest(w)
			return
		}
		owner, ok := readOwner(w, r)
		if !ok {
			return
		}
		entry, total, err := e.GetDailyEntry(r.Context(), owner, d, n)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, response{Entry: toEntryJSON(entry), Number: n, Total: total})
	})
}
