package httpclient

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNoRedirectRefusesRedirects(t *testing.T) {
	var targetHits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits.Add(1)
	}))
	defer target.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirector.Close()

	client := NoRedirect(nil, 20*time.Second)
	if client.Timeout != 20*time.Second {
		t.Errorf("Timeout = %v, want 20s", client.Timeout)
	}
	req, _ := http.NewRequest(http.MethodPost, redirector.URL, strings.NewReader(`{"key":"x"}`))
	req.Header.Set("Authorization", "Bearer secret")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTemporaryRedirect {
		t.Errorf("status = %d, want 307 returned as is", resp.StatusCode)
	}
	if n := targetHits.Load(); n != 0 {
		t.Errorf("redirect target was contacted %d times", n)
	}
}

func TestNoRedirectCopiesTheBaseClient(t *testing.T) {
	base := &http.Client{Timeout: 3 * time.Second}
	c := NoRedirect(base, time.Minute)
	if c == base || c.Timeout != 3*time.Second || c.CheckRedirect == nil {
		t.Errorf("client = %+v, want a copy of base with redirects refused", c)
	}
	if base.CheckRedirect != nil {
		t.Error("base client was changed")
	}
}
