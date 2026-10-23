package linebot

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	// staleAfter is how long a message may stay pending before the drain takes
	// it; younger ones still belong to the webhook that is handling them.
	staleAfter = 5 * time.Minute
	// drainBatch bounds the rows one Drain call looks at.
	drainBatch = 20
	// maxAttempts mirrors the store's cap on OpenAI calls per message.
	maxAttempts = 2
	// exhaustedCode is what a message that used up its attempts without an
	// answer is reported as.
	exhaustedCode = "OPENAI_TIMEOUT"
)

// Drain finishes messages that stayed pending for at least 5 minutes, oldest
// first, and does not start a new one at or after deadline. A row that
// succeeds becomes a note and a push; a row that fails, retryable or not, is
// marked failed and the failure is pushed. It ends by pruning old rows. The
// first error is returned after the whole pass has run.
func (s *Service) Drain(ctx context.Context, deadline time.Time) error {
	var first error
	note := func(err error) {
		if err != nil && first == nil {
			first = err
		}
	}

	rows, err := s.Store.ListStaleLineMessages(ctx, s.now().Add(-staleAfter), drainBatch)
	if err != nil {
		return fmt.Errorf("linebot: list stale: %w", err)
	}
	for _, row := range rows {
		if ctx.Err() != nil || !s.now().Before(deadline) {
			break
		}
		note(s.drainRow(ctx, row))
	}

	if err := s.Store.PruneLine(ctx, s.now()); err != nil {
		note(fmt.Errorf("linebot: prune: %w", err))
	}
	return first
}

func (s *Service) drainRow(ctx context.Context, row store.LineMessage) error {
	// The link decides whether the note may still be saved: gone, moved to
	// another owner, or an owner that no longer exists all end the message.
	link, err := s.Store.FindLineLink(ctx, row.LineUserID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return fmt.Errorf("linebot: find link: %w", err)
	}
	if errors.Is(err, store.ErrNotFound) || link.OwnerID != row.OwnerID {
		return s.failMessage(ctx, row.ID, "LINK_GONE")
	}
	valid, err := s.OwnerValid(ctx, link.OwnerID, link.Role)
	if err != nil {
		return fmt.Errorf("linebot: check owner: %w", err)
	}
	if !valid {
		if err := s.Store.DeleteLineLink(ctx, row.LineUserID); err != nil {
			return fmt.Errorf("linebot: delete link: %w", err)
		}
		if err := s.failMessage(ctx, row.ID, "LINK_GONE"); err != nil {
			return err
		}
		return s.push(ctx, row, line.MsgLinkGone)
	}

	started, err := s.Store.StartLineMessageAttempt(ctx, row.ID, s.now())
	if errors.Is(err, store.ErrNotFound) {
		if row.Attempts < maxAttempts {
			return nil // settled by someone else since the listing
		}
		// Both attempts are spent and no answer came: give up.
		if err := s.failMessage(ctx, row.ID, exhaustedCode); err != nil {
			return err
		}
		return s.push(ctx, row, line.FormatFailure(row.Kind, exhaustedCode))
	}
	if err != nil {
		return fmt.Errorf("linebot: start attempt: %w", err)
	}

	res, fail, err := s.generateAndSave(ctx, started.ID, started.OwnerID, started.Kind, started.Text)
	switch {
	case errors.Is(err, store.ErrNotFound):
		s.logger().Warn("line message already settled", "message_id", started.ID)
		return nil
	case err != nil:
		return err
	case fail != nil:
		// The second attempt is the last one, so even a retryable failure ends here.
		if err := s.failMessage(ctx, started.ID, fail.Code); err != nil {
			return err
		}
		return s.push(ctx, row, line.FormatFailure(started.Kind, fail.Code))
	}
	return s.push(ctx, row, line.FormatResult(started.Kind, started.Text, res.Text, res.Pinyin, res.Hints))
}

// push sends texts to the message's sender. A failure is logged (message ID
// only) and returned; it never changes stored state.
func (s *Service) push(ctx context.Context, row store.LineMessage, texts ...string) error {
	if err := s.Messenger.Push(ctx, row.LineUserID, texts...); err != nil {
		s.logger().Warn("line push failed", "message_id", row.ID)
		return fmt.Errorf("linebot: push: %w", err)
	}
	return nil
}
