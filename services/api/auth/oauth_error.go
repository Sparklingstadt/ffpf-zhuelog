package auth

import "regexp"

// oauthErrorCode matches an OAuth error code as GitHub and FFPF ID send it
// (invalid_grant, bad_verification_code, redirect_uri_mismatch, ...).
var oauthErrorCode = regexp.MustCompile(`^[a-z_]{1,64}$`)

// loggableOAuthErrorCode returns code when it looks like an OAuth error code
// and "unrecognized" otherwise, so a response that echoes the code, verifier
// or client secret (hex or base64url, with digits or hyphens) never reaches
// the log.
func loggableOAuthErrorCode(code string) string {
	if !oauthErrorCode.MatchString(code) {
		return "unrecognized"
	}
	return code
}
