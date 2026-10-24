package store

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"
)

// cleanConversations removes the owners' conversations when the test ends.
func cleanConversations(t *testing.T, s *Store, owners ...string) {
	t.Helper()
	t.Cleanup(func() {
		for _, o := range owners {
			_, _ = s.pool.Exec(context.Background(), `DELETE FROM "ChatConversation" WHERE "ownerId" = $1`, o)
		}
	})
}

// newUUID returns a random version 4 UUID, as the browser makes them.
func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func conversation(title string, createdAt time.Time, texts ...string) Conversation {
	c := Conversation{ConversationSummary: ConversationSummary{
		ID:        newUUID(),
		Title:     title,
		ModelName: "gpt-test",
		CreatedAt: createdAt,
	}}
	for i, text := range texts {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		c.Messages = append(c.Messages, ConversationMessage{ID: "m" + string(rune('0'+i)), Role: role, Text: text})
	}
	return c
}

func TestPutConversationCreatesThenUpdatesKeepingCreatedAt(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	cleanConversations(t, s, owner)
	first := fixedNow()

	c := conversation("你好", first.Add(-time.Minute), "你好", "你好！")
	saved, err := s.PutConversation(ctx, owner, c, first)
	if err != nil {
		t.Fatal(err)
	}
	if !saved.CreatedAt.Equal(dbTime(c.CreatedAt)) || !saved.UpdatedAt.Equal(dbTime(first)) {
		t.Fatalf("times = %v / %v", saved.CreatedAt, saved.UpdatedAt)
	}

	later := first.Add(time.Hour)
	c.Title = "新しい題"
	c.Ended = true
	c.CreatedAt = later // must be ignored
	c.Messages = append(c.Messages, ConversationMessage{ID: "m2", Role: "user", Text: "再见"})
	saved, err = s.PutConversation(ctx, owner, c, later)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetConversation(ctx, owner, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.CreatedAt.Equal(dbTime(first.Add(-time.Minute))) {
		t.Errorf("createdAt changed to %v", got.CreatedAt)
	}
	if !got.UpdatedAt.Equal(dbTime(later)) || got.Title != "新しい題" || !got.Ended {
		t.Errorf("not updated: %+v", got.ConversationSummary)
	}
	if !reflect.DeepEqual(got.Messages, c.Messages) || !reflect.DeepEqual(saved, got) {
		t.Errorf("messages = %+v, saved = %+v", got.Messages, saved)
	}
}

func TestPutConversationOfAnotherOwnerIsNotFound(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	cleanConversations(t, s, a, b)

	c := conversation("A の会話", fixedNow(), "你好")
	if _, err := s.PutConversation(ctx, a, c, fixedNow()); err != nil {
		t.Fatal(err)
	}
	stolen := c
	stolen.Title = "B が書いた"
	if _, err := s.PutConversation(ctx, b, stolen, fixedNow().Add(time.Hour)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	got, err := s.GetConversation(ctx, a, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "A の会話" || !got.UpdatedAt.Equal(dbTime(fixedNow())) {
		t.Errorf("A's conversation changed: %+v", got.ConversationSummary)
	}
}

func TestListConversationsIsNewestFirstAndOwnersOnly(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	cleanConversations(t, s, a, b)
	base := fixedNow()

	var ids []string
	for i := range 3 {
		c := conversation("会話", base.Add(time.Duration(i)*time.Hour), "你好")
		if _, err := s.PutConversation(ctx, a, c, base); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, c.ID)
	}
	if _, err := s.PutConversation(ctx, b, conversation("B", base.Add(5*time.Hour), "你好"), base); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListConversations(ctx, a, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != ids[2] || got[1].ID != ids[1] {
		t.Fatalf("got %+v, want ids %v then %v", got, ids[2], ids[1])
	}
	if got[0].ModelName != "gpt-test" || got[0].Title != "会話" {
		t.Errorf("summary = %+v", got[0])
	}
	empty, err := s.ListConversations(ctx, newOwner(t, s), 10)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Errorf("empty list = %#v, %v", empty, err)
	}
}

func TestGetAndDeleteConversation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, b := newOwner(t, s), newOwner(t, s)
	cleanConversations(t, s, a, b)

	c := conversation("会話", fixedNow(), "你好", "你好！")
	if _, err := s.PutConversation(ctx, a, c, fixedNow()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetConversation(ctx, b, c.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("other owner's get err = %v", err)
	}
	if err := s.DeleteConversation(ctx, b, c.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("other owner's delete err = %v", err)
	}
	if err := s.DeleteConversation(ctx, a, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetConversation(ctx, a, c.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get after delete err = %v", err)
	}
	if err := s.DeleteConversation(ctx, a, c.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete err = %v", err)
	}
}
