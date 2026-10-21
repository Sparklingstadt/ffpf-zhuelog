package auth

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
)

const testWebRedirectURI = "https://zhuelog.example/api/auth/callback"

func TestGitHubAppsPicksByRedirectURI(t *testing.T) {
	var mobileCalls, webCalls atomic.Int32
	f := newFakeGitHub(t,
		func(w http.ResponseWriter, r *http.Request) {
			_ = r.ParseForm()
			switch r.PostForm.Get("client_id") {
			case testClientID:
				mobileCalls.Add(1)
			case "web-client-id":
				webCalls.Add(1)
			}
			okToken(w, r)
		},
		okUser,
	)
	mobile := f.client()
	web := f.client()
	web.ClientID = "web-client-id"
	web.RedirectURI = testWebRedirectURI

	user, err := GitHubApps{mobile, web}.Exchange(context.Background(), testCode, testVerifier, testWebRedirectURI)
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if user.ID != 123 {
		t.Errorf("user = %+v", user)
	}
	if mobileCalls.Load() != 0 || webCalls.Load() != 1 {
		t.Errorf("mobile calls = %d, web calls = %d; want 0 and 1", mobileCalls.Load(), webCalls.Load())
	}
}

func TestGitHubAppsUnknownRedirect(t *testing.T) {
	f := newFakeGitHub(t, okToken, okUser)
	_, err := GitHubApps{f.client()}.Exchange(context.Background(), testCode, testVerifier, "https://evil.example/cb")
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if f.tokenCalls.Load() != 0 {
		t.Errorf("GitHub was called %d times, want 0", f.tokenCalls.Load())
	}
}
