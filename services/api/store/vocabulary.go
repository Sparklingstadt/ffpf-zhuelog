package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// ErrVocabularyExists is returned by PutVocabulary when the owner already
// has the same word, under another id.
var ErrVocabularyExists = errors.New("store: vocabulary word exists")

// ReviewKindVocabulary is the ReviewItem kind of a vocabulary entry; its
// targetId is the entry's id.
const ReviewKindVocabulary = "vocabulary"

// VocabularyEntry is a word an owner picked out to learn. SourceEntryID is
// the learning note it came from, or empty.
type VocabularyEntry struct {
	ID            string
	Language      string
	Word          string
	Pinyin        string
	Meaning       string
	SourceEntryID string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

const vocabularyColumns = `"id", "language", "word", "pinyin", "meaning", "sourceEntryId", "createdAt", "updatedAt"`

func scanVocabulary(row pgx.Row) (VocabularyEntry, error) {
	var v VocabularyEntry
	var source *string
	err := row.Scan(&v.ID, &v.Language, &v.Word, &v.Pinyin, &v.Meaning, &source, &v.CreatedAt, &v.UpdatedAt)
	if source != nil {
		v.SourceEntryID = *source
	}
	return v, err
}

func nullableText(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ListVocabulary returns up to limit of the owner's entries, newest first.
func (s *Store) ListVocabulary(ctx context.Context, ownerID string, limit int) ([]VocabularyEntry, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+vocabularyColumns+` FROM "VocabularyEntry"
 WHERE "ownerId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT $2`, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list vocabulary: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (VocabularyEntry, error) { return scanVocabulary(row) })
	if err != nil {
		return nil, fmt.Errorf("store: list vocabulary: %w", err)
	}
	if out == nil {
		out = []VocabularyEntry{}
	}
	return out, nil
}

// PutVocabulary adds the owner's entry under e.ID, or updates its reading
// and meaning when the id is already theirs (the word and the source stay as
// first saved). A new entry is also queued for review, due at now. Another
// owner's id returns ErrNotFound; the same word under another id returns
// ErrVocabularyExists.
func (s *Store) PutVocabulary(ctx context.Context, ownerID string, e VocabularyEntry, now time.Time) (VocabularyEntry, error) {
	now = dbTime(now)
	var out VocabularyEntry
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		out, err = scanVocabulary(tx.QueryRow(ctx, `INSERT INTO "VocabularyEntry"
 ("id", "ownerId", "language", "word", "pinyin", "meaning", "sourceEntryId", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
 ON CONFLICT ("id") DO UPDATE SET "pinyin" = EXCLUDED."pinyin", "meaning" = EXCLUDED."meaning", "updatedAt" = EXCLUDED."updatedAt"
 WHERE "VocabularyEntry"."ownerId" = EXCLUDED."ownerId"
 RETURNING `+vocabularyColumns,
			e.ID, ownerID, e.Language, e.Word, e.Pinyin, e.Meaning, nullableText(e.SourceEntryID), now))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		// Only a new entry gets a card; an edit keeps the schedule.
		_, err = tx.Exec(ctx, `INSERT INTO "ReviewItem"
 ("id", "ownerId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
 VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $6)
 ON CONFLICT ("ownerId", "language", "kind", "targetId") DO NOTHING`,
			newID(), ownerID, out.Language, ReviewKindVocabulary, out.ID, now, int(review.New))
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "VocabularyEntry_ownerId_language_word_key" {
		return VocabularyEntry{}, ErrVocabularyExists
	}
	if errors.Is(err, ErrNotFound) {
		return VocabularyEntry{}, ErrNotFound
	}
	if err != nil {
		return VocabularyEntry{}, fmt.Errorf("store: put vocabulary: %w", err)
	}
	return out, nil
}

// DeleteVocabulary removes the owner's entry and its review card (with the
// card's log). An unknown id, or another owner's, returns ErrNotFound.
func (s *Store) DeleteVocabulary(ctx context.Context, ownerID, id string) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM "VocabularyEntry" WHERE "id" = $1 AND "ownerId" = $2`, id, ownerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		_, err = tx.Exec(ctx, `DELETE FROM "ReviewItem" WHERE "ownerId" = $1 AND "kind" = $2 AND "targetId" = $3`,
			ownerID, ReviewKindVocabulary, id)
		return err
	})
	if errors.Is(err, ErrNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("store: delete vocabulary: %w", err)
	}
	return nil
}

// vocabularyByID returns the owner's entries with the given ids, by id.
func (s *Store) vocabularyByID(ctx context.Context, ownerID string, ids []string) (map[string]VocabularyEntry, error) {
	out := map[string]VocabularyEntry{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT `+vocabularyColumns+` FROM "VocabularyEntry"
 WHERE "ownerId" = $1 AND "id" = ANY($2)`, ownerID, ids)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (VocabularyEntry, error) { return scanVocabulary(row) })
	if err != nil {
		return nil, err
	}
	for _, v := range list {
		out[v.ID] = v
	}
	return out, nil
}
