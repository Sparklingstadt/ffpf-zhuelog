package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

// Batch identifies an import batch created by queueImportBatch.
type Batch struct {
	ID         string
	ImportedAt time.Time
}

// dbtx is satisfied by both *pgxpool.Pool and pgx.Tx.
type dbtx interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// isoMillisLayout formats a time as ISO 8601 with millisecond precision, as
// the web's Date#toISOString does for UTC times.
const isoMillisLayout = "2006-01-02T15:04:05.000Z07:00"

// dbTime converts t to what TIMESTAMP(3) columns store: UTC, millisecond precision.
func dbTime(t time.Time) time.Time {
	return t.UTC().Truncate(time.Millisecond)
}

const entryColumns = `"id", "kind", "originalText", "correctedText", "pinyin", "createdAt", "sharedAt"`

// entryDest returns the scan destinations for entryColumns, in order. Callers
// append destinations for any extra columns.
func entryDest(e *Entry) []any {
	return []any{&e.ID, &e.Kind, &e.OriginalText, &e.CorrectedText, &e.Pinyin, &e.CreatedAt, &e.SharedAt}
}

// entryPtrs returns pointers to the elements of entries.
func entryPtrs(entries []Entry) []*Entry {
	ptrs := make([]*Entry, len(entries))
	for i := range entries {
		ptrs[i] = &entries[i]
	}
	return ptrs
}

// scanEntries reads all rows of entryColumns and closes rows. Errors are
// returned unwrapped.
func scanEntries(rows pgx.Rows) ([]Entry, error) {
	defer rows.Close()
	entries := []Entry{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(entryDest(&e)...); err != nil {
			return nil, err
		}
		e.Hints = []Hint{}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// attachHints loads the hints of all entries with one query. Errors are
// returned unwrapped.
func attachHints(ctx context.Context, q dbtx, entries []*Entry) error {
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

// execBatch runs the batch and returns the first error unwrapped.
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

// queueImportBatch queues the inserts of an import batch named fileName and
// of its entries and hints, and returns what is being created. The batch is
// imported at now; entry i is created at now + i ms so that (createdAt, id)
// order follows the input order, as the web's one-by-one inserts do.
func queueImportBatch(b *pgx.Batch, ownerID, fileName string, drafts []EntryDraft, now time.Time) (Batch, []Entry) {
	now = dbTime(now)
	batch := Batch{ID: newID(), ImportedAt: now}
	entries := make([]Entry, len(drafts))

	b.Queue(`INSERT INTO "ImportBatch" ("id", "fileName", "rowCount", "importedAt") VALUES ($1, $2, $3, $4)`,
		batch.ID, fileName, len(drafts), now)
	for i, d := range drafts {
		e := Entry{
			ID:            newID(),
			Kind:          d.Kind,
			OriginalText:  d.OriginalText,
			CorrectedText: d.CorrectedText,
			Pinyin:        d.Pinyin,
			CreatedAt:     now.Add(time.Duration(i) * time.Millisecond),
		}
		b.Queue(`INSERT INTO "LearningEntry" ("id", "kind", "originalText", "correctedText", "pinyin", "createdAt", "ownerId", "batchId")
		         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			e.ID, e.Kind, e.OriginalText, e.CorrectedText, e.Pinyin, e.CreatedAt, ownerID, batch.ID)
		e.Hints = queueHints(b, e.ID, d.Hints)
		entries[i] = e
	}
	return batch, entries
}
