package auth

import "strings"

// Allowlist is a set of lowercase GitHub logins.
type Allowlist map[string]struct{}

// ParseAllowlist splits a comma-separated list, trimming and lowercasing each
// entry and dropping empties (same as the web's getAllowedGitHubLogins).
func ParseAllowlist(csv string) Allowlist {
	a := Allowlist{}
	for _, login := range strings.Split(csv, ",") {
		login = strings.ToLower(strings.TrimSpace(login))
		if login != "" {
			a[login] = struct{}{}
		}
	}
	return a
}

func (a Allowlist) Allows(login string) bool {
	_, ok := a[strings.ToLower(strings.TrimSpace(login))]
	return ok
}
