package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Hint is one hint attached to an entry.
type Hint struct {
	ID       string
	Content  string
	Position int
}

// Entry is a learning entry with its hints ordered by position.
type Entry struct {
	ID            string
	Kind          string
	OriginalText  string
	CorrectedText string
	Pinyin        string
	Hints         []Hint
	CreatedAt     time.Time
	SharedAt      *time.Time
}

// EntryDraft is a validated entry to create.
type EntryDraft struct {
	Kind          string
	OriginalText  string
	CorrectedText string
	Pinyin        string
	Hints         []string
}

// EntryPatch holds the fields to change; nil fields are left as they are. A
// non-nil Hints replaces all hints.
type EntryPatch struct {
	Kind          *string
	OriginalText  *string
	CorrectedText *string
	Pinyin        *string
	Hints         *[]string
}

// Cursor is the position after which a list page continues.
type Cursor struct {
	CreatedAt time.Time
	ID        string
}

// Batch identifies an import batch created by CreateBatch.
type Batch struct {
	ID         string
	ImportedAt time.Time
}

// querier is satisfied by both *pgxpool.Pool and pgx.Tx.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// dbTime converts t to what TIMESTAMP(3) columns store: UTC, millisecond precision.
func dbTime(t time.Time) time.Time {
	return t.UTC().Truncate(time.Millisecond)
}

const entryColumns = `"id", "kind", "originalText", "correctedText", "pinyin", "createdAt", "sharedAt"`

func scanEntries(rows pgx.Rows) ([]Entry, error) {
	defer rows.Close()
	entries := []Entry{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.Kind, &e.OriginalText, &e.CorrectedText, &e.Pinyin, &e.CreatedAt, &e.SharedAt); err != nil {
			return nil, err
		}
		e.Hints = []Hint{}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// attachHints loads the hints of all entries with one query.
func attachHints(ctx context.Context, q querier, entries []Entry) error {
	if len(entries) == 0 {
		return nil
	}
	ids := make([]string, len(entries))
	index := make(map[string]int, len(entries))
	for i, e := range entries {
		ids[i] = e.ID
		index[e.ID] = i
	}
	rows, err := q.Query(ctx,
		`SELECT "learningEntryId", "id", "content", "position" FROM "Hint"
		 WHERE "learningEntryId" = ANY($1) ORDER BY "learningEntryId", "position"`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var entryID string
		var h Hint
		if err := rows.Scan(&entryID, &h.ID, &h.Content, &h.Position); err != nil {
			return err
		}
		i := index[entryID]
		entries[i].Hints = append(entries[i].Hints, h)
	}
	return rows.Err()
}

// ListEntries returns up to limit of the owner's entries that are not in the
// trash, ordered by (createdAt DESC, id DESC), starting after the cursor.
func (s *Store) ListEntries(ctx context.Context, ownerID string, after *Cursor, limit int) ([]Entry, error) {
	var afterAt *time.Time
	var afterID *string
	if after != nil {
		t := dbTime(after.CreatedAt)
		afterAt, afterID = &t, &after.ID
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+entryColumns+` FROM "LearningEntry"
		 WHERE "ownerId" = $1 AND "deletedAt" IS NULL
		   AND ($2::timestamp IS NULL OR ("createdAt", "id") < ($2::timestamp, $3::text))
		 ORDER BY "createdAt" DESC, "id" DESC
		 LIMIT $4`, ownerID, afterAt, afterID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list entries: %w", err)
	}
	entries, err := scanEntries(rows)
	if err != nil {
		return nil, fmt.Errorf("store: list entries: %w", err)
	}
	if err := attachHints(ctx, s.pool, entries); err != nil {
		return nil, fmt.Errorf("store: list entry hints: %w", err)
	}
	return entries, nil
}

// GetEntry returns one of the owner's entries that is not in the trash, or
// ErrNotFound.
func (s *Store) GetEntry(ctx context.Context, ownerID, id string) (Entry, error) {
	return getEntry(ctx, s.pool, ownerID, id)
}

func getEntry(ctx context.Context, q querier, ownerID, id string) (Entry, error) {
	rows, err := q.Query(ctx,
		`SELECT `+entryColumns+` FROM "LearningEntry"
		 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NULL`, id, ownerID)
	if err != nil {
		return Entry{}, fmt.Errorf("store: get entry: %w", err)
	}
	entries, err := scanEntries(rows)
	if err != nil {
		return Entry{}, fmt.Errorf("store: get entry: %w", err)
	}
	if len(entries) == 0 {
		return Entry{}, ErrNotFound
	}
	if err := attachHints(ctx, q, entries); err != nil {
		return Entry{}, fmt.Errorf("store: get entry hints: %w", err)
	}
	return entries[0], nil
}

// queueHints queues inserts for the hints of an entry, numbered from 0, and
// returns the hints being inserted.
func queueHints(b *pgx.Batch, entryID string, contents []string) []Hint {
	hints := make([]Hint, len(contents))
	for i, content := range contents {
		hints[i] = Hint{ID: newID(), Content: content, Position: i}
		b.Queue(`INSERT INTO "Hint" ("id", "content", "position", "learningEntryId") VALUES ($1, $2, $3, $4)`,
			hints[i].ID, content, i, entryID)
	}
	return hints
}

func execBatch(ctx context.Context, tx pgx.Tx, b *pgx.Batch) error {
	res := tx.SendBatch(ctx, b)
	for i := 0; i < b.Len(); i++ {
		if _, err := res.Exec(); err != nil {
			_ = res.Close()
			return err
		}
	}
	return res.Close()
}

// CreateBatch stores drafts as one import batch named "mobile:<now>" in a
// single transaction. Every entry gets createdAt = now.
func (s *Store) CreateBatch(ctx context.Context, ownerID string, drafts []EntryDraft, now time.Time) (Batch, []Entry, error) {
	return s.CreateImportBatch(ctx, ownerID, "mobile:"+dbTime(now).Format("2006-01-02T15:04:05.000Z07:00"), drafts, now)
}

// CreateImportBatch is CreateBatch with the batch's fileName given.
func (s *Store) CreateImportBatch(ctx context.Context, ownerID, fileName string, drafts []EntryDraft, now time.Time) (Batch, []Entry, error) {
	now = dbTime(now)
	batch := Batch{ID: newID(), ImportedAt: now}
	entries := make([]Entry, len(drafts))

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		b := &pgx.Batch{}
		b.Queue(`INSERT INTO "ImportBatch" ("id", "fileName", "rowCount", "importedAt") VALUES ($1, $2, $3, $4)`,
			batch.ID, fileName, len(drafts), now)
		for i, d := range drafts {
			e := Entry{
				ID:            newID(),
				Kind:          d.Kind,
				OriginalText:  d.OriginalText,
				CorrectedText: d.CorrectedText,
				Pinyin:        d.Pinyin,
				CreatedAt:     now,
			}
			b.Queue(`INSERT INTO "LearningEntry" ("id", "kind", "originalText", "correctedText", "pinyin", "createdAt", "ownerId", "batchId")
			         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				e.ID, e.Kind, e.OriginalText, e.CorrectedText, e.Pinyin, now, ownerID, batch.ID)
			e.Hints = queueHints(b, e.ID, d.Hints)
			entries[i] = e
		}
		return execBatch(ctx, tx, b)
	})
	if err != nil {
		return Batch{}, nil, fmt.Errorf("store: create batch: %w", err)
	}
	return batch, entries, nil
}

// UpdateEntry applies the patch to one of the owner's entries that is not in
// the trash and returns the result, or ErrNotFound.
func (s *Store) UpdateEntry(ctx context.Context, ownerID, id string, p EntryPatch) (Entry, error) {
	var out Entry
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE "LearningEntry" SET
			   "kind" = COALESCE($3, "kind"),
			   "originalText" = COALESCE($4, "originalText"),
			   "correctedText" = COALESCE($5, "correctedText"),
			   "pinyin" = COALESCE($6, "pinyin")
			 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NULL`,
			id, ownerID, p.Kind, p.OriginalText, p.CorrectedText, p.Pinyin)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		if p.Hints != nil {
			b := &pgx.Batch{}
			b.Queue(`DELETE FROM "Hint" WHERE "learningEntryId" = $1`, id)
			queueHints(b, id, *p.Hints)
			if err := execBatch(ctx, tx, b); err != nil {
				return err
			}
		}
		out, err = getEntry(ctx, tx, ownerID, id)
		return err
	})
	if errors.Is(err, ErrNotFound) {
		return Entry{}, ErrNotFound
	}
	if err != nil {
		return Entry{}, fmt.Errorf("store: update entry: %w", err)
	}
	return out, nil
}

// TrashEntry moves one of the owner's entries to the trash, or returns
// ErrNotFound when it does not exist, is not theirs, or is already trashed.
func (s *Store) TrashEntry(ctx context.Context, ownerID, id string, now time.Time) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE "LearningEntry" SET "deletedAt" = $3
		 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NULL`, id, ownerID, dbTime(now))
	if err != nil {
		return fmt.Errorf("store: trash entry: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
