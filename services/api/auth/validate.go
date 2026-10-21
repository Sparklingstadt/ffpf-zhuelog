package auth

import (
	"regexp"
	"strings"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/jsstr"
)

// The web app's password-account rules (src/domain/identity/entities/
// password-account.ts). Lengths are zod's: JS .length, UTF-16 code units.
const (
	minNewPasswordUnits = 12
	maxNewPasswordUnits = 128
	maxDisplayNameUnits = 50
)

var loginIDPattern = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

// NormalizeLoginID applies the web's loginIdSchema
// (.trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/)) and reports whether
// the result is a valid loginId.
func NormalizeLoginID(s string) (string, bool) {
	s = jsstr.ToLower(jsstr.Trim(s))
	return s, loginIDPattern.MatchString(s)
}

// ValidNewPassword applies the web's passwordSchema (.min(12).max(128)): 12 to
// 128 UTF-16 code units, not trimmed.
func ValidNewPassword(s string) bool {
	n := jsstr.Len(s)
	return n >= minNewPasswordUnits && n <= maxNewPasswordUnits
}

// ValidDisplayName applies the web's displayNameSchema (.trim().min(1).max(50))
// and returns the trimmed name. A name containing NUL, which Postgres cannot
// store, is also invalid.
func ValidDisplayName(s string) (string, bool) {
	s = jsstr.Trim(s)
	n := jsstr.Len(s)
	return s, n >= 1 && n <= maxDisplayNameUnits && !strings.ContainsRune(s, 0)
}
