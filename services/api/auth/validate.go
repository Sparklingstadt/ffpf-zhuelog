package auth

import (
	"regexp"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/jsstr"
)

// The web's loginId rule (src/domain/identity/password-account.ts
// normalizeLoginId); sign-in normalises with it.
var loginIDPattern = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

// NormalizeLoginID applies the web's loginIdSchema
// (.trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/)) and reports whether
// the result is a valid loginId.
func NormalizeLoginID(s string) (string, bool) {
	s = jsstr.ToLower(jsstr.Trim(s))
	return s, loginIDPattern.MatchString(s)
}
