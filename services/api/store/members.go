package store

import (
	"context"
	"fmt"
	"strings"
)

// MemberExists reports whether ownerID ("password:<id>" or "ffpf:<sub>") is
// an existing member.
func (s *Store) MemberExists(ctx context.Context, ownerID string) (bool, error) {
	table := `"PasswordAccount"`
	id, ok := strings.CutPrefix(ownerID, MemberOwnerPrefix)
	if !ok {
		table = `"FfpfAccount"`
		if id, ok = strings.CutPrefix(ownerID, FfpfOwnerPrefix); !ok {
			return false, nil
		}
	}
	var exists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM `+table+` WHERE "id" = $1)`, id).Scan(&exists); err != nil {
		return false, fmt.Errorf("store: member exists: %w", err)
	}
	return exists, nil
}
