package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

var testPair = auth.TokenPair{AccessToken: "access-tok-123", RefreshToken: "refresh-tok-456", ExpiresIn: 900}

func wantPair(t *testing.T, body []byte) {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("body is not JSON: %q", body)
	}
	want := map[string]any{"accessToken": "access-tok-123", "refreshToken": "refresh-tok-456", "expiresIn": float64(900)}
	if len(got) != len(want) {
		t.Fatalf("body = %v, want exactly %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("body[%q] = %v, want %v", k, got[k], v)
		}
	}
}

func TestLoginGitHubHandler(t *testing.T) {
	const valid = `{"code":"c1","codeVerifier":"v1","redirectUri":"app://cb"}`

	t.Run("success passes the fields through", func(t *testing.T) {
		var gotCode, gotVerifier, gotRedirect string
		a := &fakeAuth{github: func(_ context.Context, code, verifier, redirectURI string) (auth.TokenPair, error) {
			gotCode, gotVerifier, gotRedirect = code, verifier, redirectURI
			return testPair, nil
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, "/v1/auth/github", valid, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
		}
		wantPair(t, w.Body.Bytes())
		if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Fatalf("Content-Type = %q", ct)
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("missing Cache-Control: no-store")
		}
		if gotCode != "c1" || gotVerifier != "v1" || gotRedirect != "app://cb" {
			t.Fatalf("service got (%q, %q, %q)", gotCode, gotVerifier, gotRedirect)
		}
	})

	bad := map[string]string{
		"unknown field":      `{"code":"c","codeVerifier":"v","redirectUri":"r","extra":1}`,
		"invalid json":       `{"code":`,
		"empty body":         ``,
		"empty code":         `{"code":"","codeVerifier":"v","redirectUri":"r"}`,
		"missing code":       `{"codeVerifier":"v","redirectUri":"r"}`,
		"empty verifier":     `{"code":"c","codeVerifier":"","redirectUri":"r"}`,
		"empty redirect":     `{"code":"c","codeVerifier":"v","redirectUri":""}`,
		"wrong type":         `{"code":1,"codeVerifier":"v","redirectUri":"r"}`,
		"trailing data":      valid + ` {}`,
		"trailing garbage":   valid + `x`,
		"array":              `[]`,
		"null":               `null`,
		"password-style key": `{"loginId":"a","password":"b"}`,
	}
	for name, body := range bad {
		t.Run("400 "+name, func(t *testing.T) {
			h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil) // service must not be called
			wantError(t, do(h, http.MethodPost, "/v1/auth/github", body, nil), http.StatusBadRequest, "invalid_request")
		})
	}

	errs := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"unauthorized", auth.ErrUnauthorized, 401, "unauthorized"},
		{"forbidden", auth.ErrForbidden, 403, "forbidden"},
		{"github unavailable", auth.ErrGitHubUnavailable, 502, "github_unavailable"},
		{"wrapped github unavailable", fmt.Errorf("exchange: %w", auth.ErrGitHubUnavailable), 502, "github_unavailable"},
		{"other", errors.New("db exploded"), 500, "internal"},
	}
	for _, tc := range errs {
		t.Run(tc.name, func(t *testing.T) {
			a := &fakeAuth{github: func(context.Context, string, string, string) (auth.TokenPair, error) {
				return auth.TokenPair{}, tc.err
			}}
			h, buf := testRouter(t, a, fakePinger{}, nil)
			w := do(h, http.MethodPost, "/v1/auth/github", valid, nil)
			wantError(t, w, tc.status, tc.code)
			if tc.status == 500 {
				if strings.Contains(w.Body.String(), "db exploded") {
					t.Fatal("internal error detail leaked to the client")
				}
				if !strings.Contains(buf.String(), "db exploded") {
					t.Fatalf("internal error not logged: %s", buf.String())
				}
			}
		})
	}
}

func TestErrorMessagesAreJapanese(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{auth.ErrUnauthorized, "認証が必要です。"},
		{auth.ErrForbidden, "このアカウントは利用できません。"},
		{auth.ErrThrottled, "しばらくしてから再度お試しください。"},
		{auth.ErrGitHubUnavailable, "GitHub に接続できませんでした。"},
		{errors.New("x"), "サーバーでエラーが発生しました。"},
	}
	for _, tc := range cases {
		a := &fakeAuth{password: func(context.Context, string, string, string) (auth.TokenPair, error) { return auth.TokenPair{}, tc.err }}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, "/v1/auth/password", `{"loginId":"a","password":"b"}`, nil)
		if got := decodeError(t, w).Error.Message; got != tc.want {
			t.Errorf("message for %v = %q, want %q", tc.err, got, tc.want)
		}
	}
	h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil)
	if got := decodeError(t, do(h, http.MethodPost, "/v1/auth/password", `{`, nil)).Error.Message; got != "リクエストが不正です。" {
		t.Errorf("400 message = %q", got)
	}
}

func TestLoginPasswordHandler(t *testing.T) {
	t.Run("success passes values unchanged", func(t *testing.T) {
		var gotID, gotPW string
		a := &fakeAuth{password: func(_ context.Context, _, loginID, password string) (auth.TokenPair, error) {
			gotID, gotPW = loginID, password
			return testPair, nil
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, "/v1/auth/password", `{"loginId":" Alice ","password":"pw"}`, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
		}
		wantPair(t, w.Body.Bytes())
		if gotID != " Alice " || gotPW != "pw" {
			t.Fatalf("service got (%q, %q)", gotID, gotPW)
		}
	})

	t.Run("empty strings reach the service", func(t *testing.T) {
		called := false
		a := &fakeAuth{password: func(_ context.Context, _, loginID, password string) (auth.TokenPair, error) {
			called = true
			if loginID != "" || password != "" {
				t.Errorf("service got (%q, %q)", loginID, password)
			}
			return auth.TokenPair{}, auth.ErrUnauthorized
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/password", `{"loginId":"","password":""}`, nil), 401, "unauthorized")
		if !called {
			t.Fatal("service not called for empty strings")
		}
	})

	t.Run("unauthorized", func(t *testing.T) {
		a := &fakeAuth{password: func(context.Context, string, string, string) (auth.TokenPair, error) {
			return auth.TokenPair{}, auth.ErrUnauthorized
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/password", `{"loginId":"a","password":"b"}`, nil), 401, "unauthorized")
	})

	t.Run("throttled", func(t *testing.T) {
		a := &fakeAuth{password: func(context.Context, string, string, string) (auth.TokenPair, error) {
			return auth.TokenPair{}, fmt.Errorf("wrapped: %w", auth.ErrThrottled)
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/password", `{"loginId":"a","password":"b"}`, nil), 429, "rate_limited")
	})

	// The client address is the one clientKey picks, normalised for the
	// shared throttle keys.
	clients := []struct{ name, remote, xff, want string }{
		{"remote ipv4", "192.0.2.7:5555", "", "192.0.2.7"},
		{"last xff value", "10.0.0.1:1", "1.1.1.1, 203.0.113.9", "203.0.113.9"},
		{"ipv6 by /64", "[2001:db8:0:1::5]:443", "", "2001:db8:0:1::/64"},
		{"ipv4-mapped xff", "10.0.0.1:1", "::ffff:198.51.100.4", "198.51.100.4"},
		{"garbage xff", "10.0.0.1:1", "not-an-ip", "unknown"},
	}
	for _, tc := range clients {
		t.Run("client "+tc.name, func(t *testing.T) {
			var got string
			a := &fakeAuth{password: func(_ context.Context, client, _, _ string) (auth.TokenPair, error) {
				got = client
				return testPair, nil
			}}
			h, _ := testRouter(t, a, fakePinger{}, nil)
			r := httptest.NewRequest(http.MethodPost, "/v1/auth/password", strings.NewReader(`{"loginId":"a","password":"b"}`))
			r.RemoteAddr = tc.remote
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != http.StatusOK || got != tc.want {
				t.Fatalf("status = %d, client = %q; want 200, %q", w.Code, got, tc.want)
			}
		})
	}

	for name, body := range map[string]string{
		"wrong type":    `{"loginId":123,"password":"b"}`,
		"unknown field": `{"loginId":"a","password":"b","x":true}`,
		"trailing":      `{"loginId":"a","password":"b"}{}`,
		"invalid":       `nope`,
	} {
		t.Run("400 "+name, func(t *testing.T) {
			h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil)
			wantError(t, do(h, http.MethodPost, "/v1/auth/password", body, nil), 400, "invalid_request")
		})
	}
}

func TestRefreshHandler(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		var got string
		a := &fakeAuth{refresh: func(_ context.Context, token string) (auth.TokenPair, error) {
			got = token
			return testPair, nil
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, "/v1/auth/refresh", `{"refreshToken":"old-token"}`, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
		}
		wantPair(t, w.Body.Bytes())
		if got != "old-token" {
			t.Fatalf("service got %q", got)
		}
	})

	t.Run("empty token reaches the service", func(t *testing.T) {
		a := &fakeAuth{refresh: func(_ context.Context, token string) (auth.TokenPair, error) {
			if token != "" {
				t.Errorf("service got %q", token)
			}
			return auth.TokenPair{}, auth.ErrUnauthorized
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/refresh", `{"refreshToken":""}`, nil), 401, "unauthorized")
	})

	t.Run("unauthorized", func(t *testing.T) {
		a := &fakeAuth{refresh: func(context.Context, string) (auth.TokenPair, error) {
			return auth.TokenPair{}, auth.ErrUnauthorized
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/refresh", `{"refreshToken":"x"}`, nil), 401, "unauthorized")
	})

	t.Run("forbidden", func(t *testing.T) {
		a := &fakeAuth{refresh: func(context.Context, string) (auth.TokenPair, error) {
			return auth.TokenPair{}, auth.ErrForbidden
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, "/v1/auth/refresh", `{"refreshToken":"x"}`, nil)
		wantError(t, w, 403, "forbidden")
		if got := decodeError(t, w).Error.Message; got != "このアカウントは利用できません。" {
			t.Fatalf("message = %q", got)
		}
	})

	t.Run("400 wrong type", func(t *testing.T) {
		h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/refresh", `{"refreshToken":["a"]}`, nil), 400, "invalid_request")
	})
}

func TestLogoutHandler(t *testing.T) {
	t.Run("204 without body", func(t *testing.T) {
		var got string
		a := &fakeAuth{logout: func(_ context.Context, token string) error { got = token; return nil }}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, "/v1/auth/logout", `{"refreshToken":"tok"}`, nil)
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d", w.Code)
		}
		if w.Body.Len() != 0 {
			t.Fatalf("body = %q, want empty", w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("missing Cache-Control: no-store")
		}
		if got != "tok" {
			t.Fatalf("service got %q", got)
		}
	})

	t.Run("store failure is 500", func(t *testing.T) {
		a := &fakeAuth{logout: func(context.Context, string) error { return errors.New("db down") }}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/logout", `{"refreshToken":"tok"}`, nil), 500, "internal")
	})

	t.Run("400 invalid body", func(t *testing.T) {
		h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/logout", `{"refreshToken":1}`, nil), 400, "invalid_request")
	})
}

func TestNullAndNonObjectBodiesAreRejected(t *testing.T) {
	// The fake has no hooks, so reaching the service would yield 500, not 400.
	routes := map[string]string{
		"/v1/auth/github":   `{"code":"c","codeVerifier":"v","redirectUri":"r"}`,
		"/v1/auth/password": `{"loginId":"a","password":"b"}`,
		"/v1/auth/refresh":  `{"refreshToken":"t"}`,
		"/v1/auth/logout":   `{"refreshToken":"t"}`,
	}
	nullField := map[string]string{
		"/v1/auth/github":   `{"code":null,"codeVerifier":"v","redirectUri":"r"}`,
		"/v1/auth/password": `{"loginId":"a","password":null}`,
		"/v1/auth/refresh":  `{"refreshToken":null}`,
		"/v1/auth/logout":   `{"refreshToken":null}`,
	}
	for path := range routes {
		for name, body := range map[string]string{
			"null body":   `null`,
			"array":       `[]`,
			"string":      `"x"`,
			"number":      `1`,
			"bool":        `true`,
			"null field":  nullField[path],
			"null spaced": ` null `,
		} {
			t.Run(path+" "+name, func(t *testing.T) {
				h, _ := testRouter(t, &fakeAuth{}, fakePinger{}, nil)
				wantError(t, do(h, http.MethodPost, path, body, nil), http.StatusBadRequest, "invalid_request")
			})
		}
	}
	// A valid object with surrounding whitespace is still fine.
	a := &fakeAuth{logout: func(context.Context, string) error { return nil }}
	h, _ := testRouter(t, a, fakePinger{}, nil)
	if w := do(h, http.MethodPost, "/v1/auth/logout", " \n"+routes["/v1/auth/logout"]+"\n ", nil); w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
}

func TestBodyOfExactlyLimitIsNotTooLarge(t *testing.T) {
	a := &fakeAuth{password: func(context.Context, string, string, string) (auth.TokenPair, error) {
		return auth.TokenPair{}, auth.ErrUnauthorized
	}}
	h, _ := testRouter(t, a, fakePinger{}, nil)

	prefix, suffix := `{"loginId":"a","password":"`, `"}`
	body := prefix + strings.Repeat("x", 1<<20-len(prefix)-len(suffix)) + suffix
	if len(body) != 1<<20 {
		t.Fatalf("test body is %d bytes", len(body))
	}
	w := do(h, http.MethodPost, "/v1/auth/password", body, nil)
	if w.Code == http.StatusRequestEntityTooLarge {
		t.Fatal("a body of exactly 1 MiB was rejected as too large")
	}
	wantError(t, w, http.StatusUnauthorized, "unauthorized") // decoded fine and reached the service
}

func TestBodyTooLarge(t *testing.T) {
	a := &fakeAuth{password: func(context.Context, string, string, string) (auth.TokenPair, error) {
		t.Error("service called for an oversized body")
		return auth.TokenPair{}, auth.ErrUnauthorized
	}}
	h, _ := testRouter(t, a, fakePinger{}, nil)

	prefix := `{"loginId":"a","password":"`
	// 1 MiB + 1 bytes in total, shaped like otherwise valid JSON.
	body := prefix + strings.Repeat("x", 1<<20+1-len(prefix)-2) + `"}`
	if len(body) != 1<<20+1 {
		t.Fatalf("test body is %d bytes", len(body))
	}
	wantError(t, do(h, http.MethodPost, "/v1/auth/password", body, nil), http.StatusRequestEntityTooLarge, "too_large")

	// Exactly 1 MiB of trailing data after a valid document is also too large,
	// not a plain 400.
	trailing := `{"loginId":"a","password":"b"}` + strings.Repeat(" ", 1<<20)
	wantError(t, do(h, http.MethodPost, "/v1/auth/password", trailing, nil), http.StatusRequestEntityTooLarge, "too_large")
}

func TestLogsOmitSecrets(t *testing.T) {
	secrets := []string{"gh-code-SECRET", "verifier-SECRET", "pw-SECRET", "old-refresh-SECRET", "access-tok-123", "refresh-tok-456"}
	a := &fakeAuth{
		github:   func(context.Context, string, string, string) (auth.TokenPair, error) { return testPair, nil },
		password: func(context.Context, string, string, string) (auth.TokenPair, error) { return testPair, nil },
		refresh:  func(context.Context, string) (auth.TokenPair, error) { return testPair, nil },
		logout:   func(context.Context, string) error { return nil },
	}
	h, buf := testRouter(t, a, fakePinger{}, nil)

	do(h, http.MethodPost, "/v1/auth/github?code=gh-code-SECRET", `{"code":"gh-code-SECRET","codeVerifier":"verifier-SECRET","redirectUri":"app://cb"}`, nil)
	do(h, http.MethodPost, "/v1/auth/password", `{"loginId":"alice","password":"pw-SECRET"}`, nil)
	do(h, http.MethodPost, "/v1/auth/refresh", `{"refreshToken":"old-refresh-SECRET"}`, map[string]string{"Authorization": "Bearer old-refresh-SECRET"})
	do(h, http.MethodPost, "/v1/auth/logout", `{"refreshToken":"old-refresh-SECRET"}`, nil)
	// Failure paths log too.
	do(h, http.MethodPost, "/v1/auth/password", `{"loginId":"alice","password":"pw-SECRET"`, nil)

	if buf.Len() == 0 {
		t.Fatal("nothing was logged")
	}
	for _, s := range secrets {
		if strings.Contains(buf.String(), s) {
			t.Errorf("log contains secret %q:\n%s", s, buf.String())
		}
	}
}

func TestGuestEndpoint(t *testing.T) {
	for _, body := range []string{"", `{}`} {
		a := &fakeAuth{guest: func(context.Context) (auth.TokenPair, error) { return testPair, nil }}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		w := do(h, http.MethodPost, "/v1/auth/guest", body, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("body %q: status = %d, body %q", body, w.Code, w.Body.String())
		}
		wantPair(t, w.Body.Bytes())
	}

	t.Run("service error", func(t *testing.T) {
		a := &fakeAuth{guest: func(context.Context) (auth.TokenPair, error) {
			return auth.TokenPair{}, errors.New("db exploded")
		}}
		h, _ := testRouter(t, a, fakePinger{}, nil)
		wantError(t, do(h, http.MethodPost, "/v1/auth/guest", "", nil), 500, "internal")
	})
}

func TestMeEndpoint(t *testing.T) {
	cases := []struct {
		name string
		p    auth.Principal
		me   auth.Me
		want string
	}{
		{"admin", auth.Principal{OwnerID: "42", Role: auth.RoleAdmin, Login: "alice"},
			auth.Me{OwnerID: "42", Role: "admin", Login: "alice"},
			`{"ownerId":"42","role":"admin","login":"alice"}`},
		{"member", auth.Principal{OwnerID: "password:c1", Role: auth.RoleMember},
			auth.Me{OwnerID: "password:c1", Role: "member", Login: "bob", DisplayName: "Bob", AccountID: "c1"},
			`{"ownerId":"password:c1","role":"member","login":"bob","displayName":"Bob","accountId":"c1"}`},
		{"guest", auth.Principal{OwnerID: "guest", Role: auth.RoleGuest},
			auth.Me{OwnerID: "guest", Role: "guest", Login: "guest"},
			`{"ownerId":"guest","role":"guest","login":"guest"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var gotP auth.Principal
			a := &fakeAuth{
				authenticate: func(context.Context, string) (auth.Principal, error) { return tc.p, nil },
				me: func(_ context.Context, p auth.Principal) (auth.Me, error) {
					gotP = p
					return tc.me, nil
				},
			}
			h, _ := testRouter(t, a, fakePinger{}, nil)
			w := do(h, http.MethodGet, "/v1/me", "", authHeader)
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, body %q", w.Code, w.Body.String())
			}
			if gotP != tc.p {
				t.Fatalf("Me got %+v, want %+v", gotP, tc.p)
			}
			var got, want map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatalf("body %q: %v", w.Body.String(), err)
			}
			_ = json.Unmarshal([]byte(tc.want), &want)
			if fmt.Sprint(got) != fmt.Sprint(want) {
				t.Fatalf("body = %v, want %v", got, want)
			}
		})
	}

	t.Run("me unauthorized", func(t *testing.T) {
		a := tokenAuth(auth.RoleMember)
		a.me = func(context.Context, auth.Principal) (auth.Me, error) { return auth.Me{}, auth.ErrUnauthorized }
		h, _ := testRouter(t, a, fakePinger{}, nil)
		wantError(t, do(h, http.MethodGet, "/v1/me", "", authHeader), 401, "unauthorized")
	})
}
