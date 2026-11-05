package store

import (
	"context"
	"fmt"
	"time"
)

// StudyDay is what an owner did on one JST date: reviews answered, practice
// questions answered (every question of every saved round), learning notes
// added (outside the trash) and words put in the vocabulary book.
type StudyDay struct {
	Date              LogDate
	Reviews           int
	PracticeQuestions int
	Notes             int
	Words             int
}

// StudyLog returns the owner's StudyDays from the JST date from to the JST
// date to, both included, oldest first. Days with nothing done are left out.
func (s *Store) StudyLog(ctx context.Context, ownerID string, from, to LogDate) ([]StudyDay, error) {
	start, _ := from.dayRange()
	_, end := to.dayRange()
	rows, err := s.pool.Query(ctx, `SELECT "day", sum("reviews"), sum("practice"), sum("notes"), sum("words") FROM (
  SELECT ("reviewedAt" + interval '9 hours')::date AS "day", 1 AS "reviews", 0 AS "practice", 0 AS "notes", 0 AS "words"
  FROM "ReviewLog" WHERE "ownerId" = $1 AND "reviewedAt" >= $2 AND "reviewedAt" < $3
  UNION ALL
  SELECT ("createdAt" + interval '9 hours')::date, 0, "questionCount", 0, 0
  FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
  UNION ALL
  SELECT ("createdAt" + interval '9 hours')::date, 0, "questionCount", 0, 0
  FROM "ComplementPracticeRecord" WHERE "ownerId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
  UNION ALL
  SELECT ("createdAt" + interval '9 hours')::date, 0, 0, 1, 0
  FROM "LearningEntry" WHERE "ownerId" = $1 AND "deletedAt" IS NULL AND "createdAt" >= $2 AND "createdAt" < $3
  UNION ALL
  SELECT ("createdAt" + interval '9 hours')::date, 0, 0, 0, 1
  FROM "VocabularyEntry" WHERE "ownerId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
) AS "activity" GROUP BY "day" ORDER BY "day"`, ownerID, start, end)
	if err != nil {
		return nil, fmt.Errorf("store: study log: %w", err)
	}
	defer rows.Close()
	out := []StudyDay{}
	for rows.Next() {
		var d time.Time
		var reviews, practice, notes, words int64
		if err := rows.Scan(&d, &reviews, &practice, &notes, &words); err != nil {
			return nil, fmt.Errorf("store: study log: %w", err)
		}
		out = append(out, StudyDay{
			Date:    LogDate{d.Year(), int(d.Month()), d.Day()},
			Reviews: int(reviews), PracticeQuestions: int(practice), Notes: int(notes), Words: int(words),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: study log: %w", err)
	}
	return out, nil
}
