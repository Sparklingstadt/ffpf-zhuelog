package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Statuses of a LineMessage.
const (
	LineStatusPending = "pending"
	LineStatusDone    = "done"
	LineStatusFailed  = "failed"
)

const (
	// lineMaxAttempts is how many times OpenAI may be called for one message.
	lineMaxAttempts = 2
	// lineRetention is how long done and failed messages are kept.
	lineRetention = 7 * 24 * time.Hour
)

// LineLink ties one LINE account to one owner.
type LineLink struct {
	LineUserID string
	OwnerID    string
	Role       string
	CreatedAt  time.Time
}

// LineMessage is a LINE message waiting for, or done with, processing. Text is
// empty once the message is done or failed.
type LineMessage struct {
	ID             string
	WebhookEventID string
	LineUserID     string
	OwnerID        string
	Kind           string
	Text           string
	Status         string
	Attempts       int
	EntryID        *string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

const lineMessageColumns = `"id", "webhookEventId", "lineUserId", "ownerId", "kind", COALESCE("text", ''), "status", "attempts", "entryId", "createdAt", "updatedAt"`

func (m *LineMessage) dest() []any {
	return []any{&m.ID, &m.WebhookEventID, &m.LineUserID, &m.OwnerID, &m.Kind, &m.Text, &m.Status, &m.Attempts, &m.EntryID, &m.CreatedAt, &m.UpdatedAt}
}

// FindLineLink returns the link of a LINE account, or ErrNotFound.
func (s *Store) FindLineLink(ctx context.Context, lineUserID string) (LineLink, error) {
	var l LineLink
	err := s.pool.QueryRow(ctx,
		`SELECT "lineUserId", "ownerId", "role", "createdAt" FROM "LineLink" WHERE "lineUserId" = $1`, lineUserID).
		Scan(&l.LineUserID, &l.OwnerID, &l.Role, &l.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return LineLink{}, ErrNotFound
	}
	if err != nil {
		return LineLink{}, fmt.Errorf("store: find line link: %w", err)
	}
	return l, nil
}

// LineLinked reports whether the owner has a LINE account linked.
func (s *Store) LineLinked(ctx context.Context, ownerID string) (bool, error) {
	var linked bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM "LineLink" WHERE "ownerId" = $1)`, ownerID).Scan(&linked)
	if err != nil {
		return false, fmt.Errorf("store: line linked: %w", err)
	}
	return linked, nil
}

// DeleteLineLinkByOwner removes the owner's link; it is not an error when
// there is none.
func (s *Store) DeleteLineLinkByOwner(ctx context.Context, ownerID string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM "LineLink" WHERE "ownerId" = $1`, ownerID); err != nil {
		return fmt.Errorf("store: delete line link by owner: %w", err)
	}
	return nil
}

// DeleteLineLink removes the link of a LINE account; it is not an error when
// there is none.
func (s *Store) DeleteLineLink(ctx context.Context, lineUserID string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM "LineLink" WHERE "lineUserId" = $1`, lineUserID); err != nil {
		return fmt.Errorf("store: delete line link: %w", err)
	}
	return nil
}

// PutLineLinkCode stores the hash of a link code for the owner, replacing the
// owner's previous code.
func (s *Store) PutLineLinkCode(ctx context.Context, ownerID, role, codeHash string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO "LineLinkCode" ("codeHash", "ownerId", "role", "expiresAt") VALUES ($1, $2, $3, $4)
		 ON CONFLICT ("ownerId") DO UPDATE SET
		   "codeHash" = EXCLUDED."codeHash", "role" = EXCLUDED."role", "expiresAt" = EXCLUDED."expiresAt"`,
		codeHash, ownerID, role, dbTime(expiresAt))
	if err != nil {
		return fmt.Errorf("store: put line link code: %w", err)
	}
	return nil
}

// RedeemLineLinkCode consumes an unexpired code and links lineUserID to the
// code's owner in one transaction, dropping the owner's previous link and the
// LINE account's previous link. relinked reports that the LINE account was
// already linked. An unknown or expired code returns ErrNotFound.
func (s *Store) RedeemLineLinkCode(ctx context.Context, codeHash, lineUserID string, now time.Time) (link LineLink, relinked bool, err error) {
	now = dbTime(now)
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var ownerID, role string
		err := tx.QueryRow(ctx,
			`DELETE FROM "LineLinkCode" WHERE "codeHash" = $1 AND "expiresAt" > $2 RETURNING "ownerId", "role"`,
			codeHash, now).Scan(&ownerID, &role)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}

		rows, err := tx.Query(ctx,
			`DELETE FROM "LineLink" WHERE "ownerId" = $1 OR "lineUserId" = $2 RETURNING "lineUserId"`, ownerID, lineUserID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			if id == lineUserID {
				relinked = true
			}
		}
		if err := rows.Err(); err != nil {
			return err
		}

		link = LineLink{LineUserID: lineUserID, OwnerID: ownerID, Role: role, CreatedAt: now}
		_, err = tx.Exec(ctx,
			`INSERT INTO "LineLink" ("lineUserId", "ownerId", "role", "createdAt") VALUES ($1, $2, $3, $4)`,
			lineUserID, ownerID, role, now)
		return err
	})
	if errors.Is(err, ErrNotFound) {
		return LineLink{}, false, ErrNotFound
	}
	if err != nil {
		return LineLink{}, false, fmt.Errorf("store: redeem line link code: %w", err)
	}
	return link, relinked, nil
}

// InsertLineMessage stores m as a pending message created at now. When a
// message with the same WebhookEventID exists it stores nothing and returns
// that row and false.
func (s *Store) InsertLineMessage(ctx context.Context, m LineMessage, now time.Time) (LineMessage, bool, error) {
	now = dbTime(now)
	if m.ID == "" {
		m.ID = newID()
	}
	var out LineMessage
	inserted := true
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx,
			`INSERT INTO "LineMessage" ("id", "webhookEventId", "lineUserId", "ownerId", "kind", "text", "status", "attempts", "createdAt", "updatedAt")
			 VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $7, $7)
			 ON CONFLICT ("webhookEventId") DO NOTHING
			 RETURNING `+lineMessageColumns,
			m.ID, m.WebhookEventID, m.LineUserID, m.OwnerID, m.Kind, m.Text, now).Scan(out.dest()...)
		if err == nil {
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		inserted = false
		return tx.QueryRow(ctx,
			`SELECT `+lineMessageColumns+` FROM "LineMessage" WHERE "webhookEventId" = $1`, m.WebhookEventID).Scan(out.dest()...)
	})
	if err != nil {
		return LineMessage{}, false, fmt.Errorf("store: insert line message: %w", err)
	}
	return out, inserted, nil
}

// StartLineMessageAttempt counts one OpenAI attempt on a pending message and
// returns it. It returns ErrNotFound when the message is unknown, no longer
// pending, or has used up its attempts.
func (s *Store) StartLineMessageAttempt(ctx context.Context, id string, now time.Time) (LineMessage, error) {
	var m LineMessage
	err := s.pool.QueryRow(ctx,
		`UPDATE "LineMessage" SET "attempts" = "attempts" + 1, "updatedAt" = $2
		 WHERE "id" = $1 AND "status" = 'pending' AND "attempts" < $3
		 RETURNING `+lineMessageColumns, id, dbTime(now), lineMaxAttempts).Scan(m.dest()...)
	if errors.Is(err, pgx.ErrNoRows) {
		return LineMessage{}, ErrNotFound
	}
	if err != nil {
		return LineMessage{}, fmt.Errorf("store: start line message attempt: %w", err)
	}
	return m, nil
}

// CompleteLineMessage saves draft as the owner's entry in a new "LINE" import
// batch and marks the pending message done, clearing its text, in one
// transaction. It returns ErrNotFound, creating nothing, when the message is
// not a pending message of the owner.
func (s *Store) CompleteLineMessage(ctx context.Context, id, ownerID string, draft EntryDraft, now time.Time) (Entry, error) {
	now = dbTime(now)
	var entry Entry
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		b := &pgx.Batch{}
		_, entries := queueImportBatch(b, ownerID, "LINE", []EntryDraft{draft}, now)
		entry = entries[0]
		if err := execBatch(ctx, tx, b); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx,
			`UPDATE "LineMessage" SET "status" = 'done', "entryId" = $3, "text" = NULL, "updatedAt" = $4
			 WHERE "id" = $1 AND "ownerId" = $2 AND "status" = 'pending'`, id, ownerID, entry.ID, now)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
	if errors.Is(err, ErrNotFound) {
		return Entry{}, ErrNotFound
	}
	if err != nil {
		return Entry{}, fmt.Errorf("store: complete line message: %w", err)
	}
	return entry, nil
}

// FailLineMessage marks a pending message failed and clears its text. Other
// messages are left as they are.
func (s *Store) FailLineMessage(ctx context.Context, id string, now time.Time) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE "LineMessage" SET "status" = 'failed', "text" = NULL, "updatedAt" = $2
		 WHERE "id" = $1 AND "status" = 'pending'`, id, dbTime(now))
	if err != nil {
		return fmt.Errorf("store: fail line message: %w", err)
	}
	return nil
}

// ListStaleLineMessages returns up to limit pending messages created before
// createdBefore, oldest first.
func (s *Store) ListStaleLineMessages(ctx context.Context, createdBefore time.Time, limit int) ([]LineMessage, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+lineMessageColumns+` FROM "LineMessage"
		 WHERE "status" = 'pending' AND "createdAt" < $1
		 ORDER BY "createdAt", "id" LIMIT $2`, dbTime(createdBefore), limit)
	if err != nil {
		return nil, fmt.Errorf("store: list stale line messages: %w", err)
	}
	defer rows.Close()
	msgs := []LineMessage{}
	for rows.Next() {
		var m LineMessage
		if err := rows.Scan(m.dest()...); err != nil {
			return nil, fmt.Errorf("store: list stale line messages: %w", err)
		}
		msgs = append(msgs, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list stale line messages: %w", err)
	}
	return msgs, nil
}

// PruneLine deletes done and failed messages last updated more than 7 days
// before now, and expired link codes.
func (s *Store) PruneLine(ctx context.Context, now time.Time) error {
	now = dbTime(now)
	if _, err := s.pool.Exec(ctx,
		`DELETE FROM "LineMessage" WHERE "status" IN ('done', 'failed') AND "updatedAt" < $1`, now.Add(-lineRetention)); err != nil {
		return fmt.Errorf("store: prune line messages: %w", err)
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM "LineLinkCode" WHERE "expiresAt" <= $1`, now); err != nil {
		return fmt.Errorf("store: prune line link codes: %w", err)
	}
	return nil
}
