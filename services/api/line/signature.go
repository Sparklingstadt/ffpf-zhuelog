// Package line talks to the LINE Messaging API: webhook signature checks and
// parsing, routing of incoming text, sending replies, and the reply copy.
package line

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
)

// VerifySignature reports whether signature (the X-Line-Signature header) is
// the Base64 HMAC-SHA256 of body under the channel secret. body must be the raw
// request bytes, before any parsing. An empty secret or signature never verifies.
func VerifySignature(secret, body []byte, signature string) bool {
	if len(secret) == 0 || signature == "" {
		return false
	}
	got, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(body)
	return hmac.Equal(got, mac.Sum(nil))
}
