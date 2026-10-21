package store

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const memberPrefix = "password:"

// Member is a registered member as seen by one viewer.
type Member struct {
	OwnerID     string // "password:<id>"
	DisplayName string
	LoginID     string
	Following   bool // the viewer follows this member
	FollowsMe   bool // this member follows the viewer
}

// MemberDirectory lists every member except the viewer. Members are unsorted.
type MemberDirectory struct {
	Members        []Member
	FollowingCount int // listed members the viewer follows
	FollowerCount  int // follow rows pointing at the viewer, whoever the follower is
}

// TimelineItem is a shared entry of a followed member.
type TimelineItem struct {
	Entry     Entry
	OwnerID   string
	OwnerName string
}

// ListMembers returns all members other than the viewer with their follow
// state. The viewer may be an admin id, which matches no member.
func (s *Store) ListMembers(ctx context.Context, viewerID string) (MemberDirectory, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT $2 || a."id", a."displayName", a."loginId",
		        EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = $1 AND f."followeeId" = $2 || a."id"),
		        EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = $2 || a."id" AND f."followeeId" = $1)
		 FROM "PasswordAccount" a
		 WHERE $2 || a."id" <> $1`, viewerID, memberPrefix)
	if err != nil {
		return MemberDirectory{}, fmt.Errorf("store: list members: %w", err)
	}
	defer rows.Close()
	dir := MemberDirectory{Members: []Member{}}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.OwnerID, &m.DisplayName, &m.LoginID, &m.Following, &m.FollowsMe); err != nil {
			return MemberDirectory{}, fmt.Errorf("store: list members: %w", err)
		}
		if m.Following {
			dir.FollowingCount++
		}
		dir.Members = append(dir.Members, m)
	}
	if err := rows.Err(); err != nil {
		return MemberDirectory{}, fmt.Errorf("store: list members: %w", err)
	}
	rows.Close()
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM "Follow" WHERE "followeeId" = $1`, viewerID).Scan(&dir.FollowerCount); err != nil {
		return MemberDirectory{}, fmt.Errorf("store: count followers: %w", err)
	}
	return dir, nil
}

// MemberExists reports whether ownerID ("password:<id>") is an existing member.
func (s *Store) MemberExists(ctx context.Context, ownerID string) (bool, error) {
	id, ok := strings.CutPrefix(ownerID, memberPrefix)
	if !ok {
		return false, nil
	}
	var exists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM "PasswordAccount" WHERE "id" = $1)`, id).Scan(&exists); err != nil {
		return false, fmt.Errorf("store: member exists: %w", err)
	}
	return exists, nil
}

// Follow makes followerID follow followeeID; following twice does nothing.
func (s *Store) Follow(ctx context.Context, followerID, followeeID string, now time.Time) error {
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO "Follow" ("followerId", "followeeId", "createdAt") VALUES ($1, $2, $3)
		 ON CONFLICT DO NOTHING`, followerID, followeeID, dbTime(now)); err != nil {
		return fmt.Errorf("store: follow: %w", err)
	}
	return nil
}

// Unfollow removes a follow; it does nothing when there is none.
func (s *Store) Unfollow(ctx context.Context, followerID, followeeID string) error {
	if _, err := s.pool.Exec(ctx,
		`DELETE FROM "Follow" WHERE "followerId" = $1 AND "followeeId" = $2`, followerID, followeeID); err != nil {
		return fmt.Errorf("store: unfollow: %w", err)
	}
	return nil
}

// ListTimeline returns up to limit shared, non-trashed entries of the members
// the viewer follows, ordered by (createdAt DESC, id DESC), starting after the
// cursor. Followees without a member account are skipped.
func (s *Store) ListTimeline(ctx context.Context, viewerID string, after *Cursor, limit int) ([]TimelineItem, error) {
	var afterAt *time.Time
	var afterID *string
	if after != nil {
		t := dbTime(after.CreatedAt)
		afterAt, afterID = &t, &after.ID
	}
	rows, err := s.pool.Query(ctx,
		`SELECT e."id", e."kind", e."originalText", e."correctedText", e."pinyin", e."createdAt", e."sharedAt",
		        e."ownerId", a."displayName"
		 FROM "LearningEntry" e
		 JOIN "Follow" f ON f."followeeId" = e."ownerId" AND f."followerId" = $1
		 JOIN "PasswordAccount" a ON e."ownerId" = 'password:' || a."id"
		 WHERE e."sharedAt" IS NOT NULL AND e."deletedAt" IS NULL
		   AND ($2::timestamp IS NULL OR (e."createdAt", e."id") < ($2::timestamp, $3::text))
		 ORDER BY e."createdAt" DESC, e."id" DESC
		 LIMIT $4`, viewerID, afterAt, afterID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list timeline: %w", err)
	}
	items := []TimelineItem{}
	for rows.Next() {
		var it TimelineItem
		e := &it.Entry
		if err := rows.Scan(&e.ID, &e.Kind, &e.OriginalText, &e.CorrectedText, &e.Pinyin, &e.CreatedAt, &e.SharedAt,
			&it.OwnerID, &it.OwnerName); err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: list timeline: %w", err)
		}
		e.Hints = []Hint{}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list timeline: %w", err)
	}
	entries := make([]Entry, len(items))
	for i, it := range items {
		entries[i] = it.Entry
	}
	if err := attachHints(ctx, s.pool, entries); err != nil {
		return nil, fmt.Errorf("store: list timeline hints: %w", err)
	}
	for i := range items {
		items[i].Entry = entries[i]
	}
	return items, nil
}
