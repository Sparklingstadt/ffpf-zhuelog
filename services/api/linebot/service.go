// Package linebot ties the pieces of the LINE feature together: linking a LINE
// account to an owner, turning a LINE message into a correction or translation
// learning note, and finishing the messages that were left pending.
package linebot

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/learning"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// Store is the part of *store.Store the service needs.
type Store interface {
	FindLineLink(ctx context.Context, lineUserID string) (store.LineLink, error)
	LineLinked(ctx context.Context, ownerID string) (bool, error)
	DeleteLineLinkByOwner(ctx context.Context, ownerID string) error
	DeleteLineLink(ctx context.Context, lineUserID string) error
	PutLineLinkCode(ctx context.Context, ownerID, role, codeHash string, expiresAt time.Time) error
	RedeemLineLinkCode(ctx context.Context, codeHash, lineUserID string, now time.Time) (link store.LineLink, relinked bool, err error)
	InsertLineMessage(ctx context.Context, m store.LineMessage, now time.Time) (store.LineMessage, bool, error)
	StartLineMessageAttempt(ctx context.Context, id string, now time.Time) (store.LineMessage, error)
	CompleteLineMessage(ctx context.Context, id, ownerID string, draft store.EntryDraft, now time.Time) (store.Entry, error)
	FailLineMessage(ctx context.Context, id string, now time.Time) error
	ListStaleLineMessages(ctx context.Context, createdBefore time.Time, limit int) ([]store.LineMessage, error)
	PruneLine(ctx context.Context, now time.Time) error
	ConsumeThrottle(ctx context.Context, key string, limit int, window time.Duration, now time.Time) (bool, error)
	ResetThrottle(ctx context.Context, key string) error
}

// Generator turns a text into a correction or translation.
type Generator interface {
	Generate(ctx context.Context, kind, text string) (learning.Result, error)
}

// Messenger sends LINE messages.
type Messenger interface {
	Reply(ctx context.Context, token string, texts ...string) error
	Push(ctx context.Context, to string, texts ...string) error
}

// OwnerCheck reports whether the owner may still use the feature: a member
// that still exists, or an admin that is still on the allowlist.
type OwnerCheck func(ctx context.Context, ownerID, role string) (bool, error)

// Service runs the LINE flow. Store, Generator, Messenger and OwnerValid are
// required; Now, Logger and Random have defaults.
type Service struct {
	Store      Store
	Generator  Generator
	Messenger  Messenger
	OwnerValid OwnerCheck
	Now        func() time.Time // default time.Now
	Logger     *slog.Logger     // default slog.Default(); never given text, results, keys, LINE user IDs or codes
	Random     io.Reader        // default crypto/rand.Reader
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) logger() *slog.Logger {
	if s.Logger != nil {
		return s.Logger
	}
	return slog.Default()
}

func (s *Service) random() io.Reader {
	if s.Random != nil {
		return s.Random
	}
	return rand.Reader
}

// Linked reports whether the owner has a LINE account linked.
func (s *Service) Linked(ctx context.Context, ownerID string) (bool, error) {
	return s.Store.LineLinked(ctx, ownerID)
}

// Unlink removes the owner's link; it is not an error when there is none.
func (s *Service) Unlink(ctx context.Context, ownerID string) error {
	return s.Store.DeleteLineLinkByOwner(ctx, ownerID)
}

// reply sends texts to the event's sender. A failure is logged (event ID only)
// and returned; it never changes stored state.
func (s *Service) reply(ctx context.Context, ev line.Event, texts ...string) error {
	if err := s.Messenger.Reply(ctx, ev.ReplyToken, texts...); err != nil {
		s.logger().Warn("line reply failed", "event_id", ev.WebhookEventID)
		return fmt.Errorf("linebot: reply: %w", err)
	}
	return nil
}

// HandleEvent processes one LINE message event. Events from groups and rooms
// are ignored. deadline is when the delivery has to be answered: a text is
// always saved, but with less than minTimeLeft before deadline it is left
// pending for the drain instead of being generated. A returned error means a
// store failure, or, when nothing else failed, that LINE rejected the reply.
func (s *Service) HandleEvent(ctx context.Context, ev line.Event, deadline time.Time) error {
	// UserID is also filled for group and room events, so gate on the source.
	if !ev.FromUser || ev.UserID == "" {
		return nil
	}
	text := strings.TrimSpace(ev.Text)

	if ev.IsText {
		if code, ok := codeShape(text); ok {
			return s.redeem(ctx, ev, code)
		}
	}

	link, err := s.Store.FindLineLink(ctx, ev.UserID)
	if errors.Is(err, store.ErrNotFound) {
		return s.reply(ctx, ev, line.MsgNotLinked)
	}
	if err != nil {
		return fmt.Errorf("linebot: find link: %w", err)
	}

	valid, err := s.OwnerValid(ctx, link.OwnerID, link.Role)
	if err != nil {
		return fmt.Errorf("linebot: check owner: %w", err)
	}
	if !valid {
		if err := s.Store.DeleteLineLink(ctx, ev.UserID); err != nil {
			return fmt.Errorf("linebot: delete link: %w", err)
		}
		return s.reply(ctx, ev, line.MsgLinkGone)
	}

	if !ev.IsText {
		return s.reply(ctx, ev, line.MsgUsage)
	}
	var kind string
	switch line.Classify(text) {
	case line.RouteCorrection:
		kind = learning.KindCorrection
	case line.RouteTranslation:
		kind = learning.KindTranslation
	case line.RouteTooLong:
		return s.reply(ctx, ev, line.MsgTooLong)
	default:
		return s.reply(ctx, ev, line.MsgUsage)
	}
	return s.process(ctx, ev, link, kind, text, deadline)
}

// process stores the message, generates and saves the note, and replies.
func (s *Service) process(ctx context.Context, ev line.Event, link store.LineLink, kind, text string, deadline time.Time) error {
	// The event ID is the dedup key; an empty one would collide with every
	// later empty one.
	if ev.WebhookEventID == "" {
		s.logger().Warn("line event without an event ID skipped")
		return nil
	}
	msg, created, err := s.Store.InsertLineMessage(ctx, store.LineMessage{
		WebhookEventID: ev.WebhookEventID,
		LineUserID:     ev.UserID,
		OwnerID:        link.OwnerID,
		Kind:           kind,
		Text:           text,
	}, s.now())
	if err != nil {
		return fmt.Errorf("linebot: insert message: %w", err)
	}
	if !created {
		return nil // a redelivery: already handled, or waiting for the drain
	}
	if deadline.Sub(s.now()) < minTimeLeft {
		// Too late in the delivery to call OpenAI: the text is saved, the row
		// stays pending and the next drain finishes it.
		s.logger().Info("line message deferred to the drain", "message_id", msg.ID)
		return s.reply(ctx, ev, line.MsgSlow)
	}
	if _, err := s.Store.StartLineMessageAttempt(ctx, msg.ID, s.now()); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		return fmt.Errorf("linebot: start attempt: %w", err)
	}

	res, fail, err := s.generateAndSave(ctx, msg.ID, link.OwnerID, kind, text)
	switch {
	case err != nil:
		// The row stays pending, so the drain retries; tell the user it is slow.
		if !errors.Is(err, store.ErrNotFound) {
			_ = s.reply(ctx, ev, line.MsgSlow)
			return err
		}
		s.logger().Warn("line message already settled", "message_id", msg.ID)
		return nil
	case fail != nil && fail.Retryable:
		s.logger().Info("line generation will be retried", "message_id", msg.ID, "code", fail.Code)
		return s.reply(ctx, ev, line.MsgSlow)
	case fail != nil:
		if err := s.failMessage(ctx, msg.ID, fail.Code); err != nil {
			return err
		}
		return s.reply(ctx, ev, line.FormatFailure(kind, fail.Code))
	}
	return s.reply(ctx, ev, line.FormatResult(kind, text, res.Text, res.Pinyin, res.Hints))
}

// generateAndSave calls the generator and, on success, saves the note and marks
// the message done. A generation failure comes back as fail (the row is left
// pending for the caller to settle); a store failure comes back as err, with
// store.ErrNotFound meaning the message was no longer pending.
func (s *Service) generateAndSave(ctx context.Context, id, ownerID, kind, text string) (res learning.Result, fail *learning.Error, err error) {
	res, err = s.Generator.Generate(ctx, kind, text)
	if err != nil {
		var le *learning.Error
		if errors.As(err, &le) {
			return learning.Result{}, le, nil
		}
		return learning.Result{}, &learning.Error{Code: "OPENAI_REQUEST_FAILED"}, nil
	}
	_, err = s.Store.CompleteLineMessage(ctx, id, ownerID, store.EntryDraft{
		Kind:          kind,
		OriginalText:  text,
		CorrectedText: res.Text,
		Pinyin:        res.Pinyin,
		Hints:         res.Hints,
	}, s.now())
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return learning.Result{}, nil, err
		}
		return learning.Result{}, nil, fmt.Errorf("linebot: complete message: %w", err)
	}
	return res, nil, nil
}

// failMessage marks a message failed and logs why (the code only).
func (s *Service) failMessage(ctx context.Context, id, code string) error {
	if err := s.Store.FailLineMessage(ctx, id, s.now()); err != nil {
		return fmt.Errorf("linebot: fail message: %w", err)
	}
	s.logger().Info("line message failed", "message_id", id, "code", code)
	return nil
}
