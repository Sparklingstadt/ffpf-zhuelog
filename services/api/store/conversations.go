package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ConversationMessage is one turn of a chat conversation. Role is "user" or
// "assistant".
type ConversationMessage struct {
	ID   string `json:"id"`
	Role string `json:"role"`
	Text string `json:"text"`
}

// ConversationSummary is a saved conversation without its messages.
type ConversationSummary struct {
	ID        string
	Title     string
	ModelName string
	Ended     bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Conversation is an admin's practice conversation with ChatGPT.
type Conversation struct {
	ConversationSummary
	Messages []ConversationMessage
}

const conversationSummaryColumns = `"id", "title", "modelName", "ended", "createdAt", "updatedAt"`

func (c *ConversationSummary) dest() []any {
	return []any{&c.ID, &c.Title, &c.ModelName, &c.Ended, &c.CreatedAt, &c.UpdatedAt}
}

// ListConversations returns up to limit of the owner's conversations, newest
// first by (createdAt, id).
func (s *Store) ListConversations(ctx context.Context, ownerID string, limit int) ([]ConversationSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+conversationSummaryColumns+` FROM "ChatConversation"
		 WHERE "ownerId" = $1
		 ORDER BY "createdAt" DESC, "id" DESC
		 LIMIT $2`, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list conversations: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ConversationSummary, error) {
		var c ConversationSummary
		err := row.Scan(c.dest()...)
		return c, err
	})
	if err != nil {
		return nil, fmt.Errorf("store: list conversations: %w", err)
	}
	if out == nil {
		out = []ConversationSummary{}
	}
	return out, nil
}

// GetConversation returns one of the owner's conversations, or ErrNotFound
// when it does not exist or belongs to someone else.
func (s *Store) GetConversation(ctx context.Context, ownerID, id string) (Conversation, error) {
	c, err := scanConversation(s.pool.QueryRow(ctx,
		`SELECT `+conversationSummaryColumns+`, "messages" FROM "ChatConversation"
		 WHERE "id" = $1 AND "ownerId" = $2`, id, ownerID))
	if err != nil {
		return Conversation{}, fmt.Errorf("store: get conversation: %w", err)
	}
	return c, nil
}

// PutConversation saves the whole conversation for the owner. A new one keeps
// c.CreatedAt; an existing one keeps its first createdAt and takes the title,
// model name, ended flag and messages from c. updatedAt is now. When the id
// belongs to another owner nothing changes and ErrNotFound is returned.
func (s *Store) PutConversation(ctx context.Context, ownerID string, c Conversation, now time.Time) (Conversation, error) {
	messages, err := json.Marshal(c.Messages)
	if err != nil {
		return Conversation{}, fmt.Errorf("store: put conversation: %w", err)
	}
	out, err := scanConversation(s.pool.QueryRow(ctx,
		`INSERT INTO "ChatConversation"
		   ("id", "ownerId", "title", "modelName", "ended", "messages", "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
		 ON CONFLICT ("id") DO UPDATE SET
		   "title" = EXCLUDED."title",
		   "modelName" = EXCLUDED."modelName",
		   "ended" = EXCLUDED."ended",
		   "messages" = EXCLUDED."messages",
		   "updatedAt" = EXCLUDED."updatedAt"
		 WHERE "ChatConversation"."ownerId" = EXCLUDED."ownerId"
		 RETURNING `+conversationSummaryColumns+`, "messages"`,
		c.ID, ownerID, c.Title, c.ModelName, c.Ended, string(messages), dbTime(c.CreatedAt), dbTime(now)))
	if err != nil {
		return Conversation{}, fmt.Errorf("store: put conversation: %w", err)
	}
	return out, nil
}

// DeleteConversation removes one of the owner's conversations, or returns
// ErrNotFound when there is none.
func (s *Store) DeleteConversation(ctx context.Context, ownerID, id string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM "ChatConversation" WHERE "id" = $1 AND "ownerId" = $2`, id, ownerID)
	if err != nil {
		return fmt.Errorf("store: delete conversation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// scanConversation reads a summary followed by the messages column; no row is
// ErrNotFound.
func scanConversation(row pgx.Row) (Conversation, error) {
	var c Conversation
	var messages []byte
	if err := row.Scan(append(c.dest(), &messages)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Conversation{}, ErrNotFound
		}
		return Conversation{}, err
	}
	if err := json.Unmarshal(messages, &c.Messages); err != nil {
		return Conversation{}, err
	}
	return c, nil
}
