package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

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

// vocabularyByID returns the owner's entries with the given ids, by id.
// Errors are returned unwrapped.
func vocabularyByID(ctx context.Context, q dbtx, ownerID string, ids []string) (map[string]VocabularyEntry, error) {
	out := map[string]VocabularyEntry{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT `+vocabularyColumns+` FROM "VocabularyEntry"
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
