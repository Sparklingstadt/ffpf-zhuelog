package line

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func sign(secret, body []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write(body)
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func TestVerifySignature(t *testing.T) {
	secret := []byte("channel-secret")
	body := []byte(`{"events":[]}`)
	good := sign(secret, body)

	tests := []struct {
		name   string
		secret []byte
		body   []byte
		sig    string
		want   bool
	}{
		{"valid", secret, body, good, true},
		{"body differs by one byte", secret, []byte(`{"events":[ ]}`), good, false},
		{"wrong secret", []byte("other"), body, good, false},
		{"empty header", secret, body, "", false},
		{"not base64", secret, body, "!!!not-base64!!!", false},
		{"truncated signature", secret, body, good[:len(good)-4], false},
		{"empty secret never verifies", nil, body, sign(nil, body), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := VerifySignature(tt.secret, tt.body, tt.sig); got != tt.want {
				t.Fatalf("VerifySignature = %v, want %v", got, tt.want)
			}
		})
	}
}
