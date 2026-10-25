package linebot

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/learning"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

var t0 = time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type storedCode struct {
	ownerID, role string
	expiresAt     time.Time
}

type fakeStore struct {
	links    map[string]store.LineLink // by LINE user ID
	codes    map[string]storedCode     // by hash
	messages []*store.LineMessage
	entries  []store.EntryDraft
	throttle map[string]int
	calls    []string
	listArgs struct {
		before time.Time
		limit  int
	}
	pruned     []time.Time
	failed     []string
	redeemCnt  int
	insertErr  error
	completeEr error
	failErr    error
	listErr    error
	findErr    error
	nextID     int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		links:    map[string]store.LineLink{},
		codes:    map[string]storedCode{},
		throttle: map[string]int{},
	}
}

func (f *fakeStore) call(name string) { f.calls = append(f.calls, name) }

func (f *fakeStore) called(name string) bool {
	for _, c := range f.calls {
		if c == name {
			return true
		}
	}
	return false
}

func (f *fakeStore) message(id string) *store.LineMessage {
	for _, m := range f.messages {
		if m.ID == id {
			return m
		}
	}
	return nil
}

func (f *fakeStore) FindLineLink(_ context.Context, lineUserID string) (store.LineLink, error) {
	f.call("FindLineLink")
	if f.findErr != nil {
		return store.LineLink{}, f.findErr
	}
	l, ok := f.links[lineUserID]
	if !ok {
		return store.LineLink{}, store.ErrNotFound
	}
	return l, nil
}

func (f *fakeStore) LineLinked(_ context.Context, ownerID string) (bool, error) {
	f.call("LineLinked")
	for _, l := range f.links {
		if l.OwnerID == ownerID {
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeStore) DeleteLineLinkByOwner(_ context.Context, ownerID string) error {
	f.call("DeleteLineLinkByOwner")
	for k, l := range f.links {
		if l.OwnerID == ownerID {
			delete(f.links, k)
		}
	}
	return nil
}

func (f *fakeStore) DeleteLineLink(_ context.Context, lineUserID string) error {
	f.call("DeleteLineLink")
	delete(f.links, lineUserID)
	return nil
}

func (f *fakeStore) PutLineLinkCode(_ context.Context, ownerID, role, codeHash string, expiresAt time.Time) error {
	f.call("PutLineLinkCode")
	for h, c := range f.codes {
		if c.ownerID == ownerID {
			delete(f.codes, h)
		}
	}
	f.codes[codeHash] = storedCode{ownerID, role, expiresAt}
	return nil
}

func (f *fakeStore) RedeemLineLinkCode(_ context.Context, codeHash, lineUserID string, now time.Time) (store.LineLink, bool, error) {
	f.call("RedeemLineLinkCode")
	f.redeemCnt++
	c, ok := f.codes[codeHash]
	if !ok || !c.expiresAt.After(now) {
		return store.LineLink{}, false, store.ErrNotFound
	}
	delete(f.codes, codeHash)
	_, relinked := f.links[lineUserID]
	for k, l := range f.links {
		if l.OwnerID == c.ownerID {
			delete(f.links, k)
		}
	}
	l := store.LineLink{LineUserID: lineUserID, OwnerID: c.ownerID, Role: c.role, CreatedAt: now}
	f.links[lineUserID] = l
	return l, relinked, nil
}

func (f *fakeStore) InsertLineMessage(_ context.Context, m store.LineMessage, now time.Time) (store.LineMessage, bool, error) {
	f.call("InsertLineMessage")
	if f.insertErr != nil {
		return store.LineMessage{}, false, f.insertErr
	}
	for _, e := range f.messages {
		if e.WebhookEventID == m.WebhookEventID {
			return *e, false, nil
		}
	}
	f.nextID++
	m.ID = "m" + string(rune('0'+f.nextID))
	m.Status = store.LineStatusPending
	m.CreatedAt, m.UpdatedAt = now, now
	f.messages = append(f.messages, &m)
	return m, true, nil
}

func (f *fakeStore) StartLineMessageAttempt(_ context.Context, id string, now time.Time) (store.LineMessage, error) {
	f.call("StartLineMessageAttempt")
	m := f.message(id)
	if m == nil || m.Status != store.LineStatusPending || m.Attempts >= 2 {
		return store.LineMessage{}, store.ErrNotFound
	}
	m.Attempts++
	m.UpdatedAt = now
	return *m, nil
}

func (f *fakeStore) CompleteLineMessage(_ context.Context, id, ownerID string, draft store.EntryDraft, now time.Time) (store.Entry, error) {
	f.call("CompleteLineMessage")
	if f.completeEr != nil {
		return store.Entry{}, f.completeEr
	}
	m := f.message(id)
	if m == nil || m.OwnerID != ownerID || m.Status != store.LineStatusPending {
		return store.Entry{}, store.ErrNotFound
	}
	f.entries = append(f.entries, draft)
	m.Status, m.Text, m.UpdatedAt = store.LineStatusDone, "", now
	return store.Entry{}, nil
}

func (f *fakeStore) FailLineMessage(_ context.Context, id string, now time.Time) error {
	f.call("FailLineMessage")
	if f.failErr != nil {
		return f.failErr
	}
	f.failed = append(f.failed, id)
	if m := f.message(id); m != nil && m.Status == store.LineStatusPending {
		m.Status, m.Text, m.UpdatedAt = store.LineStatusFailed, "", now
	}
	return nil
}

func (f *fakeStore) ListStaleLineMessages(_ context.Context, createdBefore time.Time, limit int) ([]store.LineMessage, error) {
	f.call("ListStaleLineMessages")
	f.listArgs.before, f.listArgs.limit = createdBefore, limit
	if f.listErr != nil {
		return nil, f.listErr
	}
	var out []store.LineMessage
	for _, m := range f.messages {
		if m.Status == store.LineStatusPending && m.CreatedAt.Before(createdBefore) && len(out) < limit {
			out = append(out, *m)
		}
	}
	return out, nil
}

func (f *fakeStore) PruneLine(_ context.Context, now time.Time) error {
	f.call("PruneLine")
	f.pruned = append(f.pruned, now)
	return nil
}

func (f *fakeStore) ConsumeThrottle(_ context.Context, key string, limit int, window time.Duration, _ time.Time) (bool, error) {
	f.call("ConsumeThrottle")
	f.throttle[key]++
	return f.throttle[key] <= limit, nil
}

func (f *fakeStore) ResetThrottle(_ context.Context, key string) error {
	f.call("ResetThrottle")
	delete(f.throttle, key)
	return nil
}

type genCall struct{ kind, text string }

type fakeGen struct {
	calls  []genCall
	result learning.Result
	err    error
	// after runs once each call finishes, e.g. to advance the clock.
	after func()
}

func (g *fakeGen) Generate(_ context.Context, kind, text string) (learning.Result, error) {
	g.calls = append(g.calls, genCall{kind, text})
	if g.after != nil {
		g.after()
	}
	if g.err != nil {
		return learning.Result{}, g.err
	}
	return g.result, nil
}

type fakeMsg struct {
	replies  [][]string // texts per call
	tokens   []string
	pushes   [][]string
	pushTo   []string
	replyErr error
	pushErr  error
}

func (m *fakeMsg) Reply(_ context.Context, token string, texts ...string) error {
	m.tokens = append(m.tokens, token)
	m.replies = append(m.replies, texts)
	return m.replyErr
}

func (m *fakeMsg) Push(_ context.Context, to string, texts ...string) error {
	m.pushTo = append(m.pushTo, to)
	m.pushes = append(m.pushes, texts)
	return m.pushErr
}

type env struct {
	svc   *Service
	store *fakeStore
	gen   *fakeGen
	msg   *fakeMsg
	clock *clock
	logs  *bytes.Buffer
	valid bool
}

const (
	testLineUser = "Uline0123456789abcdef"
	testOwner    = "owner-1"
)

func newEnv(t *testing.T) *env {
	t.Helper()
	e := &env{
		store: newFakeStore(),
		gen:   &fakeGen{result: learning.Result{Text: "你好吗？", Pinyin: "nǐ hǎo ma?", Hints: []string{"吗 は疑問"}}},
		msg:   &fakeMsg{},
		clock: &clock{t: t0},
		logs:  &bytes.Buffer{},
		valid: true,
	}
	e.svc = &Service{
		Store:      e.store,
		Generator:  e.gen,
		Messenger:  e.msg,
		OwnerValid: func(context.Context, string, string) (bool, error) { return e.valid, nil },
		Now:        e.clock.Now,
		Logger:     slog.New(slog.NewTextHandler(e.logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	}
	return e
}

func (e *env) link() {
	e.store.links[testLineUser] = store.LineLink{LineUserID: testLineUser, OwnerID: testOwner, Role: "member", CreatedAt: t0}
}

func textEvent(id, text string) line.Event {
	return line.Event{WebhookEventID: id, ReplyToken: "tok-" + id, UserID: testLineUser, Text: text, IsText: true, FromUser: true}
}

func (e *env) onlyReply(t *testing.T) string {
	t.Helper()
	if len(e.msg.replies) != 1 || len(e.msg.replies[0]) != 1 {
		t.Fatalf("replies = %v, want exactly one single-text reply", e.msg.replies)
	}
	return e.msg.replies[0][0]
}

var errBoom = errors.New("boom")
