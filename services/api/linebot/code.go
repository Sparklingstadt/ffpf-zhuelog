package linebot

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const (
	// codeAlphabet leaves out 0, O, 1 and I. Its length is 32, a divisor of
	// 256, so taking a random byte modulo it is unbiased.
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	codeLen      = 8
	codeTTL      = 10 * time.Minute

	// A LINE account may fail to redeem a code 5 times per hour.
	throttleLimit  = 5
	throttleWindow = time.Hour
)

// IssueCode creates a link code for the member or admin and returns it once;
// only its SHA-256 is stored. A new code replaces the owner's previous one.
func (s *Service) IssueCode(ctx context.Context, p auth.Principal) (code string, expiresAt time.Time, err error) {
	if p.Role != auth.RoleMember && p.Role != auth.RoleAdmin {
		return "", time.Time{}, auth.ErrForbidden
	}
	buf := make([]byte, codeLen)
	if _, err := io.ReadFull(s.random(), buf); err != nil {
		return "", time.Time{}, fmt.Errorf("linebot: random: %w", err)
	}
	for i, b := range buf {
		buf[i] = codeAlphabet[int(b)%len(codeAlphabet)]
	}
	code = string(buf)
	expiresAt = s.now().Add(codeTTL)
	if err := s.Store.PutLineLinkCode(ctx, p.OwnerID, p.Role, hashCode(code), expiresAt); err != nil {
		return "", time.Time{}, fmt.Errorf("linebot: put code: %w", err)
	}
	return code, expiresAt, nil
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

// codeShape normalizes text the way a typed code is read (NFKC, trimmed, upper
// case) and reports whether the result is shaped like a link code.
func codeShape(text string) (string, bool) {
	n := strings.ToUpper(strings.TrimSpace(norm.NFKC.String(text)))
	if utf8.RuneCountInString(n) != codeLen {
		return n, false
	}
	for _, r := range n {
		if !strings.ContainsRune(codeAlphabet, r) {
			return n, false
		}
	}
	return n, true
}

// redeem handles a message shaped like a link code: link the LINE account, or
// say why not. Failures count against the account's hourly throttle.
func (s *Service) redeem(ctx context.Context, ev line.Event, code string) error {
	key := "line-link:" + ev.UserID
	allowed, err := s.Store.ConsumeThrottle(ctx, key, throttleLimit, throttleWindow, s.now())
	if err != nil {
		return fmt.Errorf("linebot: throttle: %w", err)
	}
	if !allowed {
		return s.reply(ctx, ev, line.MsgThrottled)
	}
	_, relinked, err := s.Store.RedeemLineLinkCode(ctx, hashCode(code), ev.UserID, s.now())
	if errors.Is(err, store.ErrNotFound) {
		return s.reply(ctx, ev, line.MsgBadCode)
	}
	if err != nil {
		return fmt.Errorf("linebot: redeem code: %w", err)
	}
	if err := s.Store.ResetThrottle(ctx, key); err != nil {
		// Only costs the user part of their attempts; the link is made.
		s.logger().Warn("line throttle reset failed", "event_id", ev.WebhookEventID)
	}
	if relinked {
		return s.reply(ctx, ev, line.MsgRelinked)
	}
	return s.reply(ctx, ev, line.MsgLinked)
}
