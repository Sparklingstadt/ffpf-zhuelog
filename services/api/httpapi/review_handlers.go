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
	RecordReview(ctx context.Context, ownerID, itemID, logID string, rating review.Rating, now time.Time) (store.ReviewItem, error)
}

var _ Reviews = (*store.Store)(nil)

const (
	// Practice is Chinese for now; the language column is there for more.
	reviewLanguageChinese = "zh"
	reviewKindPreposition = "preposition"
	reviewKindComplement  = "complement"

	reviewDueDefaultLimit = 20
	reviewDueMaxLimit     = 100
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
	return out
}

// listDueReviews returns how many of the owner's items are due now and the
// first of them (?limit=, 1 to 100, default 20), the longest overdue first.
func listDueReviews(rv Reviews, now func() time.Time) http.Handler {
	type response struct {
		Count int              `json:"count"`
		Items []reviewItemJSON `json:"items"`
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
		count, err := rv.CountDueReviewItems(r.Context(), owner, at)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		items, err := rv.ListDueReviewItems(r.Context(), owner, at, limit)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		out := response{Count: count, Items: make([]reviewItemJSON, len(items))}
		for i, it := range items {
			out.Items[i] = toReviewItemJSON(it)
		}
		writeJSON(w, http.StatusOK, out)
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
