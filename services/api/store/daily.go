package store

import (
	"context"
	"fmt"
	"time"
)

// jst is Japan Standard Time, fixed at UTC+9 (no daylight saving).
var jst = time.FixedZone("JST", 9*3600)

// LogDate is a calendar date in JST.
type LogDate struct {
	Year, Month, Day int
}

// LogDateCount is a JST date and the number of live entries created on it.
type LogDateCount struct {
	Date  LogDate
	Count int
}

// dayRange returns [start, end) of the JST date d as UTC DB times.
func (d LogDate) dayRange() (time.Time, time.Time) {
	start := time.Date(d.Year, time.Month(d.Month), d.Day, 0, 0, 0, 0, jst)
	end := time.Date(d.Year, time.Month(d.Month), d.Day+1, 0, 0, 0, 0, jst)
	return dbTime(start), dbTime(end)
}

// ListLogDates returns the JST dates on which the owner has entries outside the
// trash, newest date first, with the number of entries on each.
func (s *Store) ListLogDates(ctx context.Context, ownerID string) ([]LogDateCount, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT ("createdAt" + interval '9 hours')::date AS d, count(*)
		 FROM "LearningEntry"
		 WHERE "ownerId" = $1 AND "deletedAt" IS NULL
		 GROUP BY d ORDER BY d DESC`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("store: list log dates: %w", err)
	}
	defer rows.Close()
	out := []LogDateCount{}
	for rows.Next() {
		var d time.Time
		var n int64
		if err := rows.Scan(&d, &n); err != nil {
			return nil, fmt.Errorf("store: list log dates: %w", err)
		}
		out = append(out, LogDateCount{Date: LogDate{d.Year(), int(d.Month()), d.Day()}, Count: int(n)})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list log dates: %w", err)
	}
	return out, nil
}

// ListDailyEntries returns the owner's entries outside the trash created on the
// JST date d, oldest first (ties by id).
func (s *Store) ListDailyEntries(ctx context.Context, ownerID string, d LogDate) ([]Entry, error) {
	start, end := d.dayRange()
	rows, err := s.pool.Query(ctx,
		`SELECT `+entryColumns+` FROM "LearningEntry"
		 WHERE "ownerId" = $1 AND "deletedAt" IS NULL
		   AND "createdAt" >= $2 AND "createdAt" < $3
		 ORDER BY "createdAt" ASC, "id" ASC`, ownerID, start, end)
	if err != nil {
		return nil, fmt.Errorf("store: list daily entries: %w", err)
	}
	entries, err := scanEntries(rows)
	if err != nil {
		return nil, fmt.Errorf("store: list daily entries: %w", err)
	}
	if err := attachHints(ctx, s.pool, entries); err != nil {
		return nil, fmt.Errorf("store: list daily entry hints: %w", err)
	}
	return entries, nil
}

// GetDailyEntry returns the number-th (1-based) entry of the JST date d and the
// total number of entries that day, or ErrNotFound when number is outside
// 1..total.
func (s *Store) GetDailyEntry(ctx context.Context, ownerID string, d LogDate, number int) (Entry, int, error) {
	if number < 1 {
		return Entry{}, 0, ErrNotFound
	}
	start, end := d.dayRange()
	var total int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM "LearningEntry"
		 WHERE "ownerId" = $1 AND "deletedAt" IS NULL
		   AND "createdAt" >= $2 AND "createdAt" < $3`, ownerID, start, end).Scan(&total); err != nil {
		return Entry{}, 0, fmt.Errorf("store: count daily entries: %w", err)
	}
	if int64(number) > total {
		return Entry{}, 0, ErrNotFound
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+entryColumns+` FROM "LearningEntry"
		 WHERE "ownerId" = $1 AND "deletedAt" IS NULL
		   AND "createdAt" >= $2 AND "createdAt" < $3
		 ORDER BY "createdAt" ASC, "id" ASC
		 OFFSET $4 LIMIT 1`, ownerID, start, end, number-1)
	if err != nil {
		return Entry{}, 0, fmt.Errorf("store: get daily entry: %w", err)
	}
	entries, err := scanEntries(rows)
	if err != nil {
		return Entry{}, 0, fmt.Errorf("store: get daily entry: %w", err)
	}
	if len(entries) == 0 { // removed between the two queries
		return Entry{}, 0, ErrNotFound
	}
	if err := attachHints(ctx, s.pool, entries); err != nil {
		return Entry{}, 0, fmt.Errorf("store: get daily entry hints: %w", err)
	}
	return entries[0], int(total), nil
}
