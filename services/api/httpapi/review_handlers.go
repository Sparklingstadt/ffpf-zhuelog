package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// Reviews is what the review handlers, and the practice handlers that queue
// missed questions, need from *store.Store.
type Reviews interface {
	EnqueueReviewItems(ctx context.Context, ownerID string, targets []store.ReviewTarget, now time.Time) (int, error)
	ListDueReviewItems(ctx context.Context, ownerID string, now time.Time, limit int) ([]store.ReviewItem, error)
	CountDueReviewItems(ctx context.Context, ownerID string, now time.Time) (int, error)
	CountDueReviewItemsByKind(ctx context.Context, ownerID string, now time.Time) (map[string]int, error)
	ReviewStreak(ctx context.Context, ownerID string, now time.Time) (int, error)
	ReviewDays(ctx context.Context, ownerID string, now time.Time, days int) ([]bool, error)
	EntryIDsInReview(ctx context.Context, ownerID string) ([]string, error)
	RecordReview(ctx context.Context, ownerID, itemID, logID string, rating review.Rating, now time.Time) (store.ReviewItem, error)
	EntryInReview(ctx context.Context, ownerID, entryID string) (bool, error)
	AddEntryReview(ctx context.Context, ownerID, entryID string, now time.Time) error
	RemoveEntryReview(ctx context.Context, ownerID, entryID string) error
}

var _ Reviews = (*store.Store)(nil)

const (
	// Practice is Chinese for now; the language column is there for more.
	reviewLanguageChinese = "zh"
	reviewKindPreposition = "preposition"
	reviewKindComplement  = "complement"

	reviewDueDefaultLimit = 20
	reviewDueMaxLimit     = 100

	// reviewRecentDays is how many days, up to today, the due list says
	// whether the owner reviewed on.
	reviewRecentDays = 7
)

// prepositionReviewTargets are the missed questions of a preposition round
// that name their use. A use has several phrases, so the target is the use
// and the noun: "P001:学校".
func prepositionReviewTargets(questions []store.PrepositionQuestion) []store.ReviewTarget {
	var out []store.ReviewTarget
	for _, q := range questions {
		if q.ID != "" && len(q.Misses) > 0 {
			out = append(out, store.ReviewTarget{Language: reviewLanguageChinese, Kind: reviewKindPreposition, TargetID: q.ID + ":" + q.Noun})
		}
	}
	return out
}

// complementReviewTargets are the missed questions of a complement round
// that name their question ("result-01").
func complementReviewTargets(questions []store.ComplementQuestion) []store.ReviewTarget {
	var out []store.ReviewTarget
	for _, q := range questions {
		if q.ID != "" && len(q.Misses) > 0 {
			out = append(out, store.ReviewTarget{Language: reviewLanguageChinese, Kind: reviewKindComplement, TargetID: q.ID})
		}
	}
	return out
}

// queueReviews adds targets to the owner's review queue. A nil Reviews (no
// queue configured) or no targets does nothing. The queue skips targets it
// already has, so a retried save queues nothing twice.
func queueReviews(ctx context.Context, rv Reviews, ownerID string, targets []store.ReviewTarget, now time.Time) error {
	if rv == nil || len(targets) == 0 {
		return nil
	}
	_, err := rv.EnqueueReviewItems(ctx, ownerID, targets, now)
	return err
}

type reviewItemJSON struct {
	ID         string  `json:"id"`
	Language   string  `json:"language"`
	Kind       string  `json:"kind"`
	TargetID   string  `json:"targetId"`
	Due        string  `json:"due"`
	State      int     `json:"state"`
	Reps       int     `json:"reps"`
	Lapses     int     `json:"lapses"`
	LastReview *string `json:"lastReview"`
	// Vocabulary is the word a "vocabulary" item names; absent otherwise.
	Vocabulary *vocabularyJSON `json:"vocabulary,omitempty"`
	// Entry is the note an "entry" item names; absent otherwise.
	Entry *entryJSON `json:"entry,omitempty"`
	// NextDue is when the item would next be due after each answer, by
	// rating (もう一度, 難しい, できた, 簡単); only in the due list.
	NextDue []string `json:"nextDue,omitempty"`
}

func toReviewItemJSON(it store.ReviewItem) reviewItemJSON {
	out := reviewItemJSON{
		ID: it.ID, Language: it.Language, Kind: it.Kind, TargetID: it.TargetID,
		Due: formatTime(it.Due), State: int(it.State), Reps: it.Reps, Lapses: it.Lapses,
	}
	if !it.LastReview.IsZero() {
		last := formatTime(it.LastReview)
		out.LastReview = &last
	}
	if it.Vocabulary != nil {
		v := toVocabularyJSON(*it.Vocabulary)
		out.Vocabulary = &v
	}
	if it.Entry != nil {
		e := toEntryJSON(*it.Entry)
		out.Entry = &e
	}
	return out
}

// listDueReviews returns how many of the owner's items are due now, in all
// and by kind, the first of them (?limit=, 1 to 100, default 20) with the
// longest overdue first and when each answer would bring each back, how many
// days in a row (Japan time) the owner has reviewed, and whether they
// reviewed on each of the last 7 days, oldest first.
func listDueReviews(rv Reviews, now func() time.Time) http.Handler {
	type response struct {
		Count      int              `json:"count"`
		ByKind     map[string]int   `json:"byKind"`
		StreakDays int              `json:"streakDays"`
		RecentDays []bool           `json:"recentDays"`
		Items      []reviewItemJSON `json:"items"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		limit := reviewDueDefaultLimit
		if v := r.URL.Query().Get("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > reviewDueMaxLimit {
				writeError(w, http.StatusBadRequest, codeInvalidRequest, msgReviewInvalid)
				return
			}
			limit = n
		}
		owner, at := principalFrom(r.Context()).OwnerID, now()
		byKind, err := rv.CountDueReviewItemsByKind(r.Context(), owner, at)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		count := 0
		for _, n := range byKind {
			count += n
		}
		items, err := rv.ListDueReviewItems(r.Context(), owner, at, limit)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		streak, err := rv.ReviewStreak(r.Context(), owner, at)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		recent, err := rv.ReviewDays(r.Context(), owner, at, reviewRecentDays)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{Count: count, ByKind: byKind, StreakDays: streak, RecentDays: recent, Items: make([]reviewItemJSON, len(items))}
		for i, it := range items {
			out.Items[i] = toReviewItemJSON(it)
			// A card FSRS cannot schedule only loses its preview; it can
			// still be answered and shown.
			dues, err := review.NextDues(it.Card, at)
			if err != nil {
				continue
			}
			out.Items[i].NextDue = make([]string, len(dues))
			for j, due := range dues {
				out.Items[i].NextDue[j] = formatTime(due)
			}
		}
		writeJSON(w, http.StatusOK, out)
	})
}

// countDueReviews is only how many of the owner's items are due now, for
// the badge on every page.
func countDueReviews(rv Reviews, now func() time.Time) http.Handler {
	type response struct {
		Count int `json:"count"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n, err := rv.CountDueReviewItems(r.Context(), principalFrom(r.Context()).OwnerID, now())
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, response{Count: n})
	})
}

// listEntriesInReview are the ids of the owner's notes in their review
// queue, so a list of notes can say which are in it.
func listEntriesInReview(rv Reviews) http.Handler {
	type response struct {
		EntryIDs []string `json:"entryIds"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ids, err := rv.EntryIDsInReview(r.Context(), principalFrom(r.Context()).OwnerID)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, response{EntryIDs: ids})
	})
}

// answerReview applies one answer to an item. The client makes logId (a
// UUID), so a retry is applied once.
func answerReview(rv Reviews, now func() time.Time) http.Handler {
	type request struct {
		LogID  string `json:"logId"`
		Rating int    `json:"rating"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		itemID, ok := pathValueMsg(w, r, "itemId", validReviewItemID, msgReviewNotFound)
		if !ok {
			return
		}
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		rating := review.Rating(req.Rating)
		if !validConversationID(req.LogID) || !rating.Valid() {
			writeError(w, http.StatusBadRequest, codeInvalidRequest, msgReviewInvalid)
			return
		}
		it, err := rv.RecordReview(r.Context(), principalFrom(r.Context()).OwnerID, itemID, req.LogID, rating, now())
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, codeNotFound, msgReviewNotFound)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toReviewItemJSON(it))
	})
}

// entryReviewStatus says whether the owner's note is in their review queue.
func entryReviewStatus(rv Reviews) http.Handler {
	type response struct {
		InReview bool `json:"inReview"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValue(w, r, "id", validID)
		if !ok {
			return
		}
		in, err := rv.EntryInReview(r.Context(), principalFrom(r.Context()).OwnerID, id)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, response{InReview: in})
	})
}

// addEntryReview puts the owner's note in their review queue, due now. A
// note already there keeps its card.
func addEntryReview(rv Reviews, now func() time.Time) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValue(w, r, "id", validID)
		if !ok {
			return
		}
		if err := rv.AddEntryReview(r.Context(), principalFrom(r.Context()).OwnerID, id, now()); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// removeEntryReview takes the owner's note out of their review queue, with
// its answers. A note that was not in review succeeds too.
func removeEntryReview(rv Reviews) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathValue(w, r, "id", validID)
		if !ok {
			return
		}
		if err := rv.RemoveEntryReview(r.Context(), principalFrom(r.Context()).OwnerID, id); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// validReviewItemID is a store id: "c" and 24 lowercase letters or digits.
func validReviewItemID(s string) bool {
	if len(s) != 25 || s[0] != 'c' {
		return false
	}
	for _, c := range s[1:] {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9') {
			return false
		}
	}
	return true
}
