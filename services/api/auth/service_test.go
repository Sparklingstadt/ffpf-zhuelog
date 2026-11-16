package auth

import (
	"testing"
	"time"
)

func TestNilNowUsesWallClock(t *testing.T) {
	f := newFixture()
	f.svc.Now = nil
	f.svc.Signer = NewSigner(testSecret, nil)
	before := time.Now()
	pair := f.loginAdmin(t)
	exp := f.store.row(t, pair.RefreshToken).ExpiresAt
	if exp.Before(before.Add(RefreshTTL)) || exp.After(time.Now().Add(RefreshTTL)) {
		t.Fatalf("ExpiresAt %v not based on wall clock", exp)
	}
}
