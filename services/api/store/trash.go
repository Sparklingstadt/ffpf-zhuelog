package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// TrashedEntry is an entry in the trash with the time it was moved there.
type TrashedEntry struct {
	Entry
	DeletedAt time.Time
}

// ListTrashed returns up to limit of the owner's trashed entries, ordered by
// (deletedAt DESC, id DESC), starting after the cursor. Cursor.CreatedAt holds
// the deletedAt position.
func (s *Store) ListTrashed(ctx context.Context, ownerID string, after *Cursor, limit int) ([]TrashedEntry, error) {
	var afterAt *time.Time
	var afterID *string
	if after != nil {
		t := dbTime(after.CreatedAt)
		afterAt, afterID = &t, &after.ID
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+entryColumns+`, "deletedAt" FROM "LearningEntry"
		 WHERE "ownerId" = $1 AND "deletedAt" IS NOT NULL
		   AND ($2::timestamp IS NULL OR ("deletedAt", "id") < ($2::timestamp, $3::text))
		 ORDER BY "deletedAt" DESC, "id" DESC
		 LIMIT $4`, ownerID, afterAt, afterID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list trashed: %w", err)
	}
	trashed, err := scanTrashed(rows)
	if err != nil {
		return nil, fmt.Errorf("store: list trashed: %w", err)
	}
	entries := make([]Entry, len(trashed))
	for i, t := range trashed {
		entries[i] = t.Entry
	}
	if err := attachHints(ctx, s.pool, entries); err != nil {
		return nil, fmt.Errorf("store: list trashed hints: %w", err)
	}
	for i := range trashed {
		trashed[i].Entry = entries[i]
	}
	return trashed, nil
}

func scanTrashed(rows pgx.Rows) ([]TrashedEntry, error) {
	defer rows.Close()
	out := []TrashedEntry{}
	for rows.Next() {
		var e TrashedEntry
		if err := rows.Scan(&e.ID, &e.Kind, &e.OriginalText, &e.CorrectedText, &e.Pinyin, &e.CreatedAt, &e.SharedAt, &e.DeletedAt); err != nil {
			return nil, err
		}
		e.Hints = []Hint{}
		out = append(out, e)
	}
	return out, rows.Err()
}

// RestoreEntry takes one of the owner's entries out of the trash, or returns
// ErrNotFound when it is not in their trash. sharedAt is left as it was.
func (s *Store) RestoreEntry(ctx context.Context, ownerID, id string) (Entry, error) {
	var out Entry
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE "LearningEntry" SET "deletedAt" = NULL
			 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NOT NULL`, id, ownerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		out, err = getEntry(ctx, tx, ownerID, id)
		return err
	})
	if errors.Is(err, ErrNotFound) {
		return Entry{}, ErrNotFound
	}
	if err != nil {
		return Entry{}, fmt.Errorf("store: restore entry: %w", err)
	}
	return out, nil
}

// PurgeEntry permanently deletes one of the owner's trashed entries (its hints
// go with it), or returns ErrNotFound when it is not in their trash.
func (s *Store) PurgeEntry(ctx context.Context, ownerID, id string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM "LearningEntry"
		 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NOT NULL`, id, ownerID)
	if err != nil {
		return fmt.Errorf("store: purge entry: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// EmptyTrash permanently deletes all of the owner's trashed entries and
// returns how many there were.
func (s *Store) EmptyTrash(ctx context.Context, ownerID string) (int, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM "LearningEntry" WHERE "ownerId" = $1 AND "deletedAt" IS NOT NULL`, ownerID)
	if err != nil {
		return 0, fmt.Errorf("store: empty trash: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// SetShared shares or unshares one of the owner's entries that is not in the
// trash and returns it, or ErrNotFound. Sharing an already shared entry keeps
// its first sharedAt; unsharing an unshared entry succeeds.
func (s *Store) SetShared(ctx context.Context, ownerID, id string, shared bool, now time.Time) (Entry, error) {
	var out Entry
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if shared {
			// Zero rows means already shared (keep sharedAt) or not found;
			// getEntry below tells which.
			if _, err := tx.Exec(ctx,
				`UPDATE "LearningEntry" SET "sharedAt" = $3
				 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NULL AND "sharedAt" IS NULL`,
				id, ownerID, dbTime(now)); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(ctx,
				`UPDATE "LearningEntry" SET "sharedAt" = NULL
				 WHERE "id" = $1 AND "ownerId" = $2 AND "deletedAt" IS NULL`, id, ownerID); err != nil {
				return err
			}
		}
		var err error
		out, err = getEntry(ctx, tx, ownerID, id)
		return err
	})
	if errors.Is(err, ErrNotFound) {
		return Entry{}, ErrNotFound
	}
	if err != nil {
		return Entry{}, fmt.Errorf("store: set shared: %w", err)
	}
	return out, nil
}
