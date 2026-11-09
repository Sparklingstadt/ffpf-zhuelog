package linebot

import (
	"context"
	"fmt"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	// notifyBatch bounds the accounts one run looks at.
	notifyBatch = 100
	// notifyPushReserve is the part of the month's push allowance the review
	// message never uses, so the drain can still deliver late corrections.
	notifyPushReserve = 30
	// pushMargin is the time kept for one claim and push before the deadline.
	pushMargin = 3 * time.Second
)

// QuotaReader reads the channel's push allowance for the month.
type QuotaReader interface {
	PushQuota(ctx context.Context) (line.Quota, error)
}

// ReviewNotify reports whether the owner has LINE linked and asked for the
// morning review message.
func (s *Service) ReviewNotify(ctx context.Context, ownerID string) (linked, on bool, err error) {
	return s.Store.LineReviewNotify(ctx, ownerID)
}

// SetReviewNotify turns the owner's morning review message on or off;
// store.ErrNotFound means no LINE account is linked.
func (s *Service) SetReviewNotify(ctx context.Context, ownerID string, on bool) error {
	return s.Store.SetLineReviewNotify(ctx, ownerID, on)
}

// NotifyDueReviews pushes one message to each LINE account that asked for it
// and whose owner has reviews due, at most once per JST day. It stays inside
// the month's push allowance minus notifyPushReserve, and sends nothing
// without a Quota reader. Owners that may no longer use LINE are skipped (the
// webhook and the drain remove their links). A failed push is logged and not
// retried that day. The first error is returned after the whole pass.
func (s *Service) NotifyDueReviews(ctx context.Context, deadline time.Time) error {
	if s.Quota == nil {
		return nil
	}
	targets, err := s.Store.ListReviewNotifyTargets(ctx, s.now(), notifyBatch)
	if err != nil {
		return fmt.Errorf("linebot: list review notify targets: %w", err)
	}
	if len(targets) == 0 {
		return nil
	}
	quota, err := s.Quota.PushQuota(ctx)
	if err != nil {
		s.logger().Warn("review notifications skipped: quota unknown")
		return fmt.Errorf("linebot: push quota: %w", err)
	}
	budget := len(targets)
	if !quota.Unlimited {
		budget = min(budget, quota.Remaining-notifyPushReserve)
	}
	if budget < len(targets) {
		s.logger().Warn("review notifications limited by the push quota", "wanted", len(targets), "allowed", max(budget, 0))
	}

	var first error
	sent := 0
	for _, t := range targets {
		if sent >= budget || ctx.Err() != nil || deadline.Sub(s.now()) < pushMargin {
			break
		}
		valid, err := s.OwnerValid(ctx, t.OwnerID, t.Role)
		if err != nil {
			if first == nil {
				first = fmt.Errorf("linebot: check owner: %w", err)
			}
			continue
		}
		if !valid {
			continue
		}
		claimed, err := s.Store.ClaimReviewNotify(ctx, t.LineUserID, s.now())
		if err != nil {
			if first == nil {
				first = err
			}
			continue
		}
		if !claimed {
			continue
		}
		if err := s.Messenger.Push(ctx, t.LineUserID, line.FormatReviewReminder(t.Due)); err != nil {
			s.logger().Warn("review notification push failed")
			if first == nil {
				first = fmt.Errorf("linebot: push review notification: %w", err)
			}
			continue
		}
		sent++
	}
	s.logger().Info("review notifications sent", "count", sent)
	return first
}

var _ QuotaReader = (*line.Client)(nil)

// storeReviewNotify is the part of Store the review message needs; it is in
// Store so the fakes keep one type.
type storeReviewNotify interface {
	LineReviewNotify(ctx context.Context, ownerID string) (bool, bool, error)
	SetLineReviewNotify(ctx context.Context, ownerID string, on bool) error
	ListReviewNotifyTargets(ctx context.Context, now time.Time, limit int) ([]store.ReviewNotifyTarget, error)
	ClaimReviewNotify(ctx context.Context, lineUserID string, now time.Time) (bool, error)
}
