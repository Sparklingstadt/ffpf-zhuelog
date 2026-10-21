package auth

import (
	"regexp"
	"strings"
)

var githubIDPattern = regexp.MustCompile(`^[0-9]+$`)

// Allowlist is a set of numeric GitHub user IDs in decimal. Admins are
// identified by ID, never by login: a login can be renamed and then registered
// by someone else.
type Allowlist map[string]struct{}

// ParseAllowlist splits a comma-separated list, trimming each entry and
// keeping only all-digit ones (same as the web's getAllowedGitHubIds).
func ParseAllowlist(csv string) Allowlist {
	a := Allowlist{}
	for _, id := range strings.Split(csv, ",") {
		id = strings.TrimSpace(id)
		if githubIDPattern.MatchString(id) {
			a[id] = struct{}{}
		}
	}
	return a
}

// Allows reports whether id, a decimal GitHub user ID, is listed. It is an
// exact match: no trimming or other normalisation.
func (a Allowlist) Allows(id string) bool {
	_, ok := a[id]
	return ok
}
