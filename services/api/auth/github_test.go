package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	testClientID     = "client-id-abc"
	testClientSecret = "client-secret-xyz"
	testRedirectURI  = "zhuelog://auth/callback"
	testCode         = "code-0123456789"
	testVerifier     = "verifier-abcdefghijklmnopqrstuvwxyz0123456789"
	testGHToken      = "gho_testtoken1234567890"
)

type fakeGitHub struct {
	srv         *httptest.Server
	tokenCalls  atomic.Int32
	userCalls   atomic.Int32
	tokenHandle http.HandlerFunc
	userHandle  http.HandlerFunc
}

func newFakeGitHub(t *testing.T, token, user http.HandlerFunc) *fakeGitHub {
	t.Helper()
	f := &fakeGitHub{tokenHandle: token, userHandle: user}
	mux := http.NewServeMux()
	mux.HandleFunc("/login/oauth/access_token", func(w http.ResponseWriter, r *http.Request) {
		f.tokenCalls.Add(1)
		f.tokenHandle(w, r)
	})
	mux.HandleFunc("/user", func(w http.ResponseWriter, r *http.Request) {
		f.userCalls.Add(1)
		f.userHandle(w, r)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeGitHub) client() *GitHubClient {
	return &GitHubClient{
		HTTP:         f.srv.Client(),
		ClientID:     testClientID,
		ClientSecret: testClientSecret,
		RedirectURI:  testRedirectURI,
		TokenURL:     f.srv.URL + "/login/oauth/access_token",
		APIURL:       f.srv.URL,
	}
}

func okToken(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"access_token":"` + testGHToken + `","token_type":"bearer","scope":""}`))
}

func okUser(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"id":123,"login":"Alice"}`))
}

func TestExchangeSuccess(t *testing.T) {
	var gotForm map[string]string
	var gotTokenHeaders http.Header
	var gotMethod, gotContentType string
	var gotUserHeaders http.Header
	var gotUserMethod string

	f := newFakeGitHub(t,
		func(w http.ResponseWriter, r *http.Request) {
			gotMethod = r.Method
			gotContentType = r.Header.Get("Content-Type")
			gotTokenHeaders = r.Header.Clone()
			if err := r.ParseForm(); err != nil {
				t.Errorf("ParseForm: %v", err)
			}
			gotForm = map[string]string{}
			for k := range r.PostForm {
				gotForm[k] = r.PostForm.Get(k)
			}
			okToken(w, r)
		},
		func(w http.ResponseWriter, r *http.Request) {
			gotUserMethod = r.Method
			gotUserHeaders = r.Header.Clone()
			okUser(w, r)
		},
	)

	user, err := f.client().Exchange(context.Background(), testCode, testVerifier, testRedirectURI)
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if user != (GitHubUser{ID: 123, Login: "Alice"}) {
		t.Fatalf("user = %+v", user)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("token method = %q", gotMethod)
	}
	if gotContentType != "application/x-www-form-urlencoded" {
		t.Errorf("token Content-Type = %q", gotContentType)
	}
	if got := gotTokenHeaders.Get("Accept"); got != "application/json" {
		t.Errorf("token Accept = %q", got)
	}
	want := map[string]string{
		"client_id":     testClientID,
		"client_secret": testClientSecret,
		"code":          testCode,
		"code_verifier": testVerifier,
		"redirect_uri":  testRedirectURI,
	}
	for k, v := range want {
		if gotForm[k] != v {
			t.Errorf("form[%s] = %q, want %q", k, gotForm[k], v)
		}
	}

	if gotUserMethod != http.MethodGet {
		t.Errorf("user method = %q", gotUserMethod)
	}
	if got := gotUserHeaders.Get("Authorization"); got != "Bearer "+testGHToken {
		t.Errorf("user Authorization = %q", got)
	}
	if got := gotUserHeaders.Get("Accept"); got != "application/vnd.github+json" {
		t.Errorf("user Accept = %q", got)
	}
	if got := gotUserHeaders.Get("X-GitHub-Api-Version"); got != "2022-11-28" {
		t.Errorf("user X-GitHub-Api-Version = %q", got)
	}
}

func TestExchangeRedirectMismatch(t *testing.T) {
	f := newFakeGitHub(t, okToken, okUser)
	_, err := f.client().Exchange(context.Background(), testCode, testVerifier, "https://evil.example/callback")
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if n := f.tokenCalls.Load() + f.userCalls.Load(); n != 0 {
		t.Fatalf("fake GitHub was called %d times", n)
	}
}

func TestExchangeEmptyInputs(t *testing.T) {
	f := newFakeGitHub(t, okToken, okUser)
	c := f.client()
	for name, args := range map[string][2]string{
		"empty code":     {"", testVerifier},
		"empty verifier": {testCode, ""},
	} {
		_, err := c.Exchange(context.Background(), args[0], args[1], testRedirectURI)
		if !errors.Is(err, ErrUnauthorized) {
			t.Errorf("%s: err = %v, want ErrUnauthorized", name, err)
		}
	}
	if n := f.tokenCalls.Load(); n != 0 {
		t.Fatalf("token endpoint called %d times", n)
	}
}

func TestExchangeBadCode(t *testing.T) {
	f := newFakeGitHub(t,
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"error":"bad_verification_code","error_description":"The code passed is incorrect or expired."}`))
		}, okUser)
	_, err := f.client().Exchange(context.Background(), testCode, testVerifier, testRedirectURI)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if f.userCalls.Load() != 0 {
		t.Fatal("/user must not be called after a token error")
	}
}

func TestExchangeUserUnauthorized(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		f := newFakeGitHub(t, okToken, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
		})
		_, err := f.client().Exchange(context.Background(), testCode, testVerifier, testRedirectURI)
		if !errors.Is(err, ErrUnauthorized) {
			t.Errorf("status %d: err = %v, want ErrUnauthorized", status, err)
		}
	}
}

func TestExchangeUnavailable(t *testing.T) {
	cases := map[string]func(t *testing.T) *GitHubClient{
		"token endpoint 500": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusInternalServerError)
			}, okUser).client()
		},
		"token endpoint malformed JSON": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`not json`))
			}, okUser).client()
		},
		"token 200 without access_token or error": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{}`))
			}, okUser).client()
		},
		"closed server": func(t *testing.T) *GitHubClient {
			f := newFakeGitHub(t, okToken, okUser)
			c := f.client()
			f.srv.Close()
			return c
		},
		"user endpoint 500": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, okToken, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusInternalServerError)
			}).client()
		},
		"user endpoint 404": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, okToken, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNotFound)
			}).client()
		},
		"user endpoint malformed JSON": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, okToken, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"id":`))
			}).client()
		},
		"user id zero": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, okToken, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"id":0,"login":"Alice"}`))
			}).client()
		},
		"user id negative": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, okToken, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"id":-5,"login":"Alice"}`))
			}).client()
		},
		"user empty login": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, okToken, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"id":123,"login":""}`))
			}).client()
		},
	}
	for name, mk := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := mk(t).Exchange(context.Background(), testCode, testVerifier, testRedirectURI)
			if !errors.Is(err, ErrGitHubUnavailable) {
				t.Fatalf("err = %v, want ErrGitHubUnavailable", err)
			}
		})
	}
}

func TestExchangeTimeoutAndCancel(t *testing.T) {
	release := make(chan struct{})
	f := newFakeGitHub(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}, okUser)
	t.Cleanup(func() { close(release) })

	t.Run("client timeout", func(t *testing.T) {
		c := f.client()
		c.HTTP = &http.Client{Timeout: 50 * time.Millisecond}
		_, err := c.Exchange(context.Background(), testCode, testVerifier, testRedirectURI)
		if !errors.Is(err, ErrGitHubUnavailable) {
			t.Fatalf("err = %v, want ErrGitHubUnavailable", err)
		}
	})
	t.Run("context deadline", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		_, err := f.client().Exchange(ctx, testCode, testVerifier, testRedirectURI)
		if !errors.Is(err, ErrGitHubUnavailable) {
			t.Fatalf("err = %v, want ErrGitHubUnavailable", err)
		}
	})
	t.Run("context canceled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := f.client().Exchange(ctx, testCode, testVerifier, testRedirectURI)
		if !errors.Is(err, ErrGitHubUnavailable) {
			t.Fatalf("err = %v, want ErrGitHubUnavailable", err)
		}
	})
}

func TestExchangeDefaultURLs(t *testing.T) {
	// Empty TokenURL/APIURL must fall back to GitHub; route them to the fake
	// server via a custom transport so no real network is touched.
	var tokenHost, userHost string
	rt := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/login/oauth/access_token":
			tokenHost = r.URL.Scheme + "://" + r.URL.Host
			return jsonResponse(`{"access_token":"` + testGHToken + `"}`), nil
		case "/user":
			userHost = r.URL.Scheme + "://" + r.URL.Host
			return jsonResponse(`{"id":7,"login":"bob"}`), nil
		}
		return nil, errors.New("unexpected request")
	})
	c := &GitHubClient{
		HTTP:         &http.Client{Transport: rt},
		ClientID:     testClientID,
		ClientSecret: testClientSecret,
		RedirectURI:  testRedirectURI,
	}
	user, err := c.Exchange(context.Background(), testCode, testVerifier, testRedirectURI)
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if user != (GitHubUser{ID: 7, Login: "bob"}) {
		t.Fatalf("user = %+v", user)
	}
	if tokenHost != "https://github.com" {
		t.Errorf("token host = %q", tokenHost)
	}
	if userHost != "https://api.github.com" {
		t.Errorf("user host = %q", userHost)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func jsonResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       readCloser{strings.NewReader(body)},
	}
}

type readCloser struct{ *strings.Reader }

func (readCloser) Close() error { return nil }

func TestExchangeErrorsOmitSecrets(t *testing.T) {
	secrets := []string{testCode, testClientSecret, testVerifier, testGHToken}

	// Worst case: the server echoes the request back in an error body.
	echoStatus := func(status int) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			_ = r.ParseForm()
			w.WriteHeader(status)
			_, _ = w.Write([]byte(r.PostForm.Encode() + r.Header.Get("Authorization")))
		}
	}
	echo := echoStatus(http.StatusInternalServerError)
	echoJSON := func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		_, _ = w.Write([]byte(`{"error":"` + r.PostForm.Get("code") + r.PostForm.Get("client_secret") + `"}`))
	}

	clients := map[string]func(t *testing.T) *GitHubClient{
		"token 500 echo":   func(t *testing.T) *GitHubClient { return newFakeGitHub(t, echo, okUser).client() },
		"token error echo": func(t *testing.T) *GitHubClient { return newFakeGitHub(t, echoJSON, okUser).client() },
		"user 500 echo":    func(t *testing.T) *GitHubClient { return newFakeGitHub(t, okToken, echo).client() },
		"user 401 echo": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, okToken, echoStatus(http.StatusUnauthorized)).client()
		},
		"user malformed echo": func(t *testing.T) *GitHubClient {
			return newFakeGitHub(t, okToken, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(testGHToken + "{")) }).client()
		},
		"closed server": func(t *testing.T) *GitHubClient {
			f := newFakeGitHub(t, okToken, okUser)
			c := f.client()
			f.srv.Close()
			return c
		},
		"redirect mismatch": func(t *testing.T) *GitHubClient { return newFakeGitHub(t, okToken, okUser).client() },
	}
	for name, mk := range clients {
		t.Run(name, func(t *testing.T) {
			redirect := testRedirectURI
			if name == "redirect mismatch" {
				redirect = "https://evil.example/" + testCode
			}
			_, err := mk(t).Exchange(context.Background(), testCode, testVerifier, redirect)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !errors.Is(err, ErrUnauthorized) && !errors.Is(err, ErrGitHubUnavailable) {
				t.Fatalf("err = %v is neither sentinel", err)
			}
			for _, s := range secrets {
				if strings.Contains(err.Error(), s) {
					t.Errorf("error %q contains secret %q", err.Error(), s)
				}
			}
		})
	}
}
