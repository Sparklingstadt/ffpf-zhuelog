package httpapi

import (
	"context"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// Reviews is the review queue that saved practice rounds add their missed
// questions to. The web reads and answers the queue itself.
type Reviews interface {
	EnqueueReviewItems(ctx context.Context, ownerID string, targets []store.ReviewTarget, now time.Time) (int, error)
}

var _ Reviews = (*store.Store)(nil)

const (
	// Practice is Chinese for now; the language column is there for more.
	reviewLanguageChinese = "zh"
	reviewKindPreposition = "preposition"
	reviewKindComplement  = "complement"
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
