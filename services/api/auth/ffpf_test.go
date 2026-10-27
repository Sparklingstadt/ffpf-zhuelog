package auth

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	ffpfTestClientID     = "zhuelog"
	ffpfTestClientSecret = "ffpf-client-secret-xyz"
	ffpfTestRedirectURI  = "https://zhuelog.example/api/auth/callback/ffpf"
	ffpfTestCode         = "ffpf-code-0123456789"
	ffpfTestVerifier     = "ffpf-verifier-abcdefghijklmnopqrstuvwxyz0123456789"
	ffpfTestNonce        = "ffpf-nonce-0123456789"
	ffpfTestAccessToken  = "ffpf-access-token-0123456789"
)

// ffpfTestNow is the clock of every test, so exp near the 60 s leeway does not
// depend on how long a test takes.
var ffpfTestNow = time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)

func newFFPFTestKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func ffpfB64(data []byte) string { return base64.RawURLEncoding.EncodeToString(data) }

// signFFPFJWT signs header.claims as ES256 does: r‖s, 32 bytes each.
func signFFPFJWT(t *testing.T, key *ecdsa.PrivateKey, header, claims map[string]any) string {
	t.Helper()
	h, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}
	c, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	input := ffpfB64(h) + "." + ffpfB64(c)
	digest := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return input + "." + ffpfB64(sig)
}

func signFFPFIDToken(t *testing.T, key *ecdsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	return signFFPFJWT(t, key, map[string]any{"alg": "ES256", "typ": "JWT", "kid": kid}, claims)
}

func ffpfJWK(key *ecdsa.PrivateKey, kid string) map[string]any {
	var x, y [32]byte
	key.X.FillBytes(x[:])
	key.Y.FillBytes(y[:])
	return map[string]any{"kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "kid": kid, "x": ffpfB64(x[:]), "y": ffpfB64(y[:])}
}

// fakeFFPF is an FFPF ID portal with /oauth/token and /oauth/jwks. The token
// endpoint answers with idToken unless token is set.
type fakeFFPF struct {
	srv *httptest.Server

	mu        sync.Mutex
	idToken   string
	token     http.HandlerFunc
	jwks      []map[string]any
	jwksFails bool
	jwksRaw   string // when set, the JWKS answer instead of jwks

	tokenCalls atomic.Int32
	jwksCalls  atomic.Int32
}

func newFakeFFPF(t *testing.T) *fakeFFPF {
	t.Helper()
	f := &fakeFFPF{}
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		f.tokenCalls.Add(1)
		f.mu.Lock()
		token, idToken := f.token, f.idToken
		f.mu.Unlock()
		if token != nil {
			token(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": ffpfTestAccessToken, "token_type": "Bearer", "expires_in": 300,
			"id_token": idToken, "scope": "openid email profile",
		})
	})
	mux.HandleFunc("/oauth/jwks", func(w http.ResponseWriter, _ *http.Request) {
		f.jwksCalls.Add(1)
		f.mu.Lock()
		jwks, fails, raw := f.jwks, f.jwksFails, f.jwksRaw
		f.mu.Unlock()
		if fails {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if raw != "" {
			_, _ = w.Write([]byte(raw))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": jwks})
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeFFPF) set(fn func(f *fakeFFPF)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

// client uses the server's own client, which follows redirects: the FFPF
// client must refuse them itself.
func (f *fakeFFPF) client() *FFPFClient {
	return &FFPFClient{
		HTTP:         f.srv.Client(),
		Issuer:       f.srv.URL,
		ClientID:     ffpfTestClientID,
		ClientSecret: ffpfTestClientSecret,
		RedirectURI:  ffpfTestRedirectURI,
		now:          func() time.Time { return ffpfTestNow },
	}
}

func (f *fakeFFPF) claims() map[string]any {
	return map[string]any{
		"iss":            f.srv.URL,
		"aud":            ffpfTestClientID,
		"sub":            "cabc123",
		"exp":            ffpfTestNow.Add(5 * time.Minute).Unix(),
		"iat":            ffpfTestNow.Unix(),
		"nonce":          ffpfTestNonce,
		"email":          "alice@example.com",
		"email_verified": true,
		"name":           "ふわ",
	}
}

func exchangeFFPF(c *FFPFClient) (FFPFUser, error) {
	return c.Exchange(context.Background(), ffpfTestCode, ffpfTestVerifier, ffpfTestRedirectURI, ffpfTestNonce)
}

func assertNoFFPFSecrets(t *testing.T, s string) {
	t.Helper()
	for _, secret := range []string{ffpfTestClientSecret, ffpfTestCode, ffpfTestVerifier, ffpfTestAccessToken, "eyJ"} {
		if strings.Contains(s, secret) {
			t.Errorf("%q contains %q", s, secret)
		}
	}
}

func TestFFPFExchangeSuccess(t *testing.T) {
	f := newFakeFFPF(t)
	key := newFFPFTestKey(t)
	var gotMethod, gotContentType, gotAccept, gotUser, gotPass string
	var gotOK bool
	var gotForm url.Values
	f.set(func(f *fakeFFPF) {
		f.jwks = []map[string]any{ffpfJWK(key, "k1")}
		f.idToken = signFFPFIDToken(t, key, "k1", f.claims())
		idToken := f.idToken
		f.token = func(w http.ResponseWriter, r *http.Request) {
			gotMethod, gotContentType, gotAccept = r.Method, r.Header.Get("Content-Type"), r.Header.Get("Accept")
			gotUser, gotPass, gotOK = r.BasicAuth()
			_ = r.ParseForm()
			gotForm = r.PostForm
			_ = json.NewEncoder(w).Encode(map[string]any{"id_token": idToken, "token_type": "Bearer"})
		}
	})
	user, err := exchangeFFPF(f.client())
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if user != (FFPFUser{Sub: "cabc123", Email: "alice@example.com", Name: "ふわ"}) {
		t.Errorf("user = %+v", user)
	}
	if gotMethod != http.MethodPost || !strings.HasPrefix(gotContentType, "application/x-www-form-urlencoded") ||
		gotAccept != "application/json" {
		t.Errorf("method = %q, content type = %q, accept = %q", gotMethod, gotContentType, gotAccept)
	}
	if !gotOK || gotUser != ffpfTestClientID || gotPass != ffpfTestClientSecret {
		t.Errorf("basic auth = %q, %q, %v", gotUser, gotPass, gotOK)
	}
	want := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {ffpfTestCode},
		"code_verifier": {ffpfTestVerifier},
		"redirect_uri":  {ffpfTestRedirectURI},
	}
	if len(gotForm) != len(want) {
		t.Errorf("form = %v, want %v", gotForm, want)
	}
	for k := range want {
		if gotForm.Get(k) != want.Get(k) {
			t.Errorf("form %s = %q, want %q", k, gotForm.Get(k), want.Get(k))
		}
	}
	if f.tokenCalls.Load() != 1 || f.jwksCalls.Load() != 1 {
		t.Errorf("token calls = %d, jwks calls = %d, want 1 and 1", f.tokenCalls.Load(), f.jwksCalls.Load())
	}
}

// RFC 6749 §2.3.1: the client id and secret are form-encoded before they go
// into the Basic credentials.
func TestFFPFExchangeFormEncodesBasicCredentials(t *testing.T) {
	f := newFakeFFPF(t)
	key := newFFPFTestKey(t)
	var gotAuth string
	f.set(func(f *fakeFFPF) {
		f.jwks = []map[string]any{ffpfJWK(key, "k1")}
		claims := f.claims()
		claims["aud"] = "id:with space"
		idToken := signFFPFIDToken(t, key, "k1", claims)
		f.token = func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			_ = json.NewEncoder(w).Encode(map[string]any{"id_token": idToken})
		}
	})
	c := f.client()
	c.ClientID, c.ClientSecret = "id:with space", "s&cret/+="
	if _, err := exchangeFFPF(c); err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(gotAuth, "Basic "))
	if err != nil {
		t.Fatalf("Authorization = %q: %v", gotAuth, err)
	}
	if want := "id%3Awith+space:s%26cret%2F%2B%3D"; string(raw) != want {
		t.Errorf("credentials = %q, want %q", raw, want)
	}
}

func TestFFPFExchangeAccepts(t *testing.T) {
	for name, tc := range map[string]struct {
		change func(c map[string]any)
		want   FFPFUser
	}{
		"exp 60 seconds ago": {
			change: func(c map[string]any) { c["exp"] = ffpfTestNow.Add(-60 * time.Second).Unix() },
			want:   FFPFUser{Sub: "cabc123", Email: "alice@example.com", Name: "ふわ"},
		},
		"aud as an array": {
			change: func(c map[string]any) { c["aud"] = []string{"other", ffpfTestClientID} },
			want:   FFPFUser{Sub: "cabc123", Email: "alice@example.com", Name: "ふわ"},
		},
		"no name": {
			change: func(c map[string]any) { delete(c, "name") },
			want:   FFPFUser{Sub: "cabc123", Email: "alice@example.com", Name: "alice"},
		},
		"blank name": {
			change: func(c map[string]any) { c["name"] = "  " },
			want:   FFPFUser{Sub: "cabc123", Email: "alice@example.com", Name: "alice"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := newFakeFFPF(t)
			key := newFFPFTestKey(t)
			claims := f.claims()
			tc.change(claims)
			f.set(func(f *fakeFFPF) {
				f.jwks = []map[string]any{ffpfJWK(key, "k1")}
				f.idToken = signFFPFIDToken(t, key, "k1", claims)
			})
			user, err := exchangeFFPF(f.client())
			if err != nil || user != tc.want {
				t.Fatalf("user = %+v, err = %v, want %+v", user, err, tc.want)
			}
		})
	}
}

func TestFFPFExchangeRejectsIDToken(t *testing.T) {
	other := newFFPFTestKey(t)
	withClaim := func(name string, value any) func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
		return func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			c := f.claims()
			if value == nil {
				delete(c, name)
			} else {
				c[name] = value
			}
			return signFFPFIDToken(t, key, "k1", c)
		}
	}
	for name, tc := range map[string]struct {
		token  func(f *fakeFFPF, key *ecdsa.PrivateKey) string
		reason string
	}{
		"other iss": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			c := f.claims()
			c["iss"] = f.srv.URL + "/other"
			return signFFPFIDToken(t, key, "k1", c)
		}, "iss"},
		"iss with a trailing slash": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			c := f.claims()
			c["iss"] = f.srv.URL + "/"
			return signFFPFIDToken(t, key, "k1", c)
		}, "iss"},
		"other aud":                    {withClaim("aud", "other"), "aud"},
		"aud array without the client": {withClaim("aud", []string{"other"}), "aud"},
		"no aud":                       {withClaim("aud", nil), "aud"},
		"exp 61 seconds ago":           {withClaim("exp", ffpfTestNow.Add(-61*time.Second).Unix()), "exp"},
		"no exp":                       {withClaim("exp", nil), "exp"},
		"exp as a string":              {withClaim("exp", "9999999999"), "claims"},
		"other nonce":                  {withClaim("nonce", "other"), "nonce"},
		"no nonce":                     {withClaim("nonce", nil), "nonce"},
		"email_verified false":         {withClaim("email_verified", false), "email_verified"},
		"email_verified as a string":   {withClaim("email_verified", "true"), "email_verified"},
		"no email_verified":            {withClaim("email_verified", nil), "email_verified"},
		"no email":                     {withClaim("email", nil), "email"},
		"empty email":                  {withClaim("email", ""), "email"},
		"sub A/B":                      {withClaim("sub", "A/B"), "sub"},
		"sub with upper case":          {withClaim("sub", "Cabc"), "sub"},
		"sub too long":                 {withClaim("sub", strings.Repeat("a", 65)), "sub"},
		"no sub":                       {withClaim("sub", nil), "sub"},
		"signed with another key": {func(f *fakeFFPF, _ *ecdsa.PrivateKey) string {
			return signFFPFIDToken(t, other, "k1", f.claims())
		}, "signature"},
		"alg none": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			token := signFFPFJWT(t, key, map[string]any{"alg": "none", "kid": "k1"}, f.claims())
			return token[:strings.LastIndex(token, ".")+1]
		}, "malformed"},
		"alg none with a signature": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			return signFFPFJWT(t, key, map[string]any{"alg": "none", "kid": "k1"}, f.claims())
		}, "alg"},
		"alg HS256": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			return signFFPFJWT(t, key, map[string]any{"alg": "HS256", "kid": "k1"}, f.claims())
		}, "alg"},
		"typ other": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			return signFFPFJWT(t, key, map[string]any{"alg": "ES256", "typ": "at+jwt", "kid": "k1"}, f.claims())
		}, "typ"},
		"no kid": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			return signFFPFJWT(t, key, map[string]any{"alg": "ES256", "typ": "JWT"}, f.claims())
		}, "kid"},
		"kid not in the JWKS": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			return signFFPFIDToken(t, key, "k9", f.claims())
		}, "kid"},
		"four segments": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			return signFFPFIDToken(t, key, "k1", f.claims()) + ".x"
		}, "malformed"},
		"padded signature": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			return signFFPFIDToken(t, key, "k1", f.claims()) + "="
		}, "malformed"},
		"short signature": {func(f *fakeFFPF, key *ecdsa.PrivateKey) string {
			token := signFFPFIDToken(t, key, "k1", f.claims())
			return token[:strings.LastIndex(token, ".")+1] + ffpfB64(make([]byte, 63))
		}, "signature"},
		"not a JWT": {func(*fakeFFPF, *ecdsa.PrivateKey) string { return "not a jwt" }, "malformed"},
	} {
		t.Run(name, func(t *testing.T) {
			f := newFakeFFPF(t)
			key := newFFPFTestKey(t)
			f.set(func(f *fakeFFPF) {
				f.jwks = []map[string]any{ffpfJWK(key, "k1")}
				f.idToken = tc.token(f, key)
			})
			var buf bytes.Buffer
			c := f.client()
			c.Logger = slog.New(slog.NewJSONHandler(&buf, nil))
			user, err := exchangeFFPF(c)
			if !errors.Is(err, ErrUnauthorized) || user != (FFPFUser{}) {
				t.Fatalf("user = %+v, err = %v, want ErrUnauthorized", user, err)
			}
			var entry map[string]any
			if jsonErr := json.Unmarshal(buf.Bytes(), &entry); jsonErr != nil {
				t.Fatalf("log = %q: %v", buf.String(), jsonErr)
			}
			if entry["level"] != "WARN" || entry["reason"] != tc.reason {
				t.Errorf("log = %v, want WARN with reason %q", entry, tc.reason)
			}
			assertNoFFPFSecrets(t, buf.String())
		})
	}
}

func TestFFPFExchangeRejectsTokenResponse(t *testing.T) {
	for name, answer := range map[string]http.HandlerFunc{
		"token 400": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		},
		"token 401": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
		},
		"token 400 echoing the secret": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"` + ffpfTestClientSecret + `"}`))
		},
		"no id_token": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"access_token":"a","token_type":"Bearer"}`))
		},
		"id_token not a string": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"id_token":1}`)) },
		"not JSON":              func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`<html>`)) },
	} {
		t.Run(name, func(t *testing.T) {
			f := newFakeFFPF(t)
			f.set(func(f *fakeFFPF) { f.token = answer })
			var buf bytes.Buffer
			c := f.client()
			c.Logger = slog.New(slog.NewJSONHandler(&buf, nil))
			user, err := exchangeFFPF(c)
			if !errors.Is(err, ErrUnauthorized) || user != (FFPFUser{}) {
				t.Fatalf("user = %+v, err = %v, want ErrUnauthorized", user, err)
			}
			if f.jwksCalls.Load() != 0 {
				t.Errorf("jwks calls = %d, want 0", f.jwksCalls.Load())
			}
			if !strings.Contains(buf.String(), `"level":"WARN"`) {
				t.Errorf("log = %q, want a warning", buf.String())
			}
			assertNoFFPFSecrets(t, buf.String())
		})
	}
}

// Input that cannot succeed is refused before FFPF ID is called.
func TestFFPFExchangeRejectsInputWithoutCalling(t *testing.T) {
	for name, args := range map[string][4]string{
		"other redirect URI": {ffpfTestCode, ffpfTestVerifier, "https://evil.example/cb", ffpfTestNonce},
		"empty code":         {"", ffpfTestVerifier, ffpfTestRedirectURI, ffpfTestNonce},
		"empty verifier":     {ffpfTestCode, "", ffpfTestRedirectURI, ffpfTestNonce},
		"empty nonce":        {ffpfTestCode, ffpfTestVerifier, ffpfTestRedirectURI, ""},
	} {
		t.Run(name, func(t *testing.T) {
			f := newFakeFFPF(t)
			_, err := f.client().Exchange(context.Background(), args[0], args[1], args[2], args[3])
			if !errors.Is(err, ErrUnauthorized) {
				t.Fatalf("err = %v, want ErrUnauthorized", err)
			}
			if f.tokenCalls.Load() != 0 || f.jwksCalls.Load() != 0 {
				t.Errorf("token calls = %d, jwks calls = %d, want none", f.tokenCalls.Load(), f.jwksCalls.Load())
			}
		})
	}
}

func TestFFPFExchangeUnavailable(t *testing.T) {
	for name, setup := range map[string]func(f *fakeFFPF){
		"token 500": func(f *fakeFFPF) {
			f.token = func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }
		},
		"token 502": func(f *fakeFFPF) {
			f.token = func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) }
		},
		"token 3xx is not followed": func(f *fakeFFPF) {
			f.token = func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("moved") != "" {
					_ = json.NewEncoder(w).Encode(map[string]any{"id_token": f.idToken})
					return
				}
				http.Redirect(w, r, "/oauth/token?moved=1", http.StatusTemporaryRedirect)
			}
		},
		"jwks 500":          func(f *fakeFFPF) { f.jwksFails = true },
		"jwks not JSON":     func(f *fakeFFPF) { f.jwksRaw = `<html>` },
		"jwks without keys": func(f *fakeFFPF) { f.jwksRaw = `{}` },
	} {
		t.Run(name, func(t *testing.T) {
			f := newFakeFFPF(t)
			key := newFFPFTestKey(t)
			f.set(func(f *fakeFFPF) {
				f.jwks = []map[string]any{ffpfJWK(key, "k1")}
				f.idToken = signFFPFIDToken(t, key, "k1", f.claims())
				setup(f)
			})
			user, err := exchangeFFPF(f.client())
			if !errors.Is(err, ErrFFPFUnavailable) || user != (FFPFUser{}) {
				t.Fatalf("user = %+v, err = %v, want ErrFFPFUnavailable", user, err)
			}
			assertNoFFPFSecrets(t, err.Error())
			if name == "token 3xx is not followed" && f.tokenCalls.Load() != 1 {
				t.Errorf("token calls = %d, want 1 (the redirect was followed)", f.tokenCalls.Load())
			}
		})
	}
	t.Run("server down", func(t *testing.T) {
		f := newFakeFFPF(t)
		c := f.client()
		f.srv.Close()
		user, err := exchangeFFPF(c)
		if !errors.Is(err, ErrFFPFUnavailable) || user != (FFPFUser{}) {
			t.Fatalf("user = %+v, err = %v, want ErrFFPFUnavailable", user, err)
		}
		assertNoFFPFSecrets(t, err.Error())
	})
}

func TestFFPFRefetchesJWKSOnceForUnknownKid(t *testing.T) {
	f := newFakeFFPF(t)
	first, second, unknown := newFFPFTestKey(t), newFFPFTestKey(t), newFFPFTestKey(t)
	c := f.client()
	f.set(func(f *fakeFFPF) {
		f.jwks = []map[string]any{ffpfJWK(first, "k1")}
		f.idToken = signFFPFIDToken(t, first, "k1", f.claims())
	})
	if _, err := exchangeFFPF(c); err != nil {
		t.Fatal(err)
	}
	// The portal rotates its key while the cached JWKS is still fresh.
	f.set(func(f *fakeFFPF) {
		f.jwks = []map[string]any{ffpfJWK(second, "k2")}
		f.idToken = signFFPFIDToken(t, second, "k2", f.claims())
	})
	if user, err := exchangeFFPF(c); err != nil || user.Sub != "cabc123" {
		t.Fatalf("user = %+v, err = %v", user, err)
	}
	if got := f.jwksCalls.Load(); got != 2 {
		t.Fatalf("jwks calls = %d, want 2", got)
	}
	// A kid the portal does not have either costs one fetch, then is refused.
	f.set(func(f *fakeFFPF) { f.idToken = signFFPFIDToken(t, unknown, "k3", f.claims()) })
	if _, err := exchangeFFPF(c); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if got := f.jwksCalls.Load(); got != 3 {
		t.Fatalf("jwks calls = %d, want 3", got)
	}
}

// The JWKS is cached for 10 minutes; after that a failed fetch is not
// covered by the stale keys.
func TestFFPFCachesJWKS(t *testing.T) {
	f := newFakeFFPF(t)
	key := newFFPFTestKey(t)
	now := ffpfTestNow
	c := f.client()
	c.now = func() time.Time { return now }
	sign := func() {
		f.set(func(f *fakeFFPF) {
			claims := f.claims()
			claims["exp"] = now.Add(5 * time.Minute).Unix()
			f.idToken = signFFPFIDToken(t, key, "k1", claims)
		})
	}
	f.set(func(f *fakeFFPF) { f.jwks = []map[string]any{ffpfJWK(key, "k1")} })
	sign()
	for range 3 {
		if _, err := exchangeFFPF(c); err != nil {
			t.Fatal(err)
		}
	}
	if got := f.jwksCalls.Load(); got != 1 {
		t.Fatalf("jwks calls = %d, want 1", got)
	}

	now = now.Add(10*time.Minute + time.Second)
	sign()
	if _, err := exchangeFFPF(c); err != nil {
		t.Fatal(err)
	}
	if got := f.jwksCalls.Load(); got != 2 {
		t.Fatalf("jwks calls = %d, want 2", got)
	}

	now = now.Add(10*time.Minute + time.Second)
	sign()
	f.set(func(f *fakeFFPF) { f.jwksFails = true })
	if _, err := exchangeFFPF(c); !errors.Is(err, ErrFFPFUnavailable) {
		t.Fatalf("err = %v, want ErrFFPFUnavailable (no fallback to stale keys)", err)
	}
}

// Keys that are not P-256 signing keys, or whose point is off the curve, are
// ignored.
func TestFFPFIgnoresUnusableJWKs(t *testing.T) {
	f := newFakeFFPF(t)
	key := newFFPFTestKey(t)
	offCurve := ffpfJWK(key, "k1")
	offCurve["y"] = ffpfB64(make([]byte, 32))
	encryption := ffpfJWK(key, "k1")
	encryption["use"] = "enc"
	f.set(func(f *fakeFFPF) {
		f.jwks = []map[string]any{
			{"kty": "RSA", "kid": "k1", "n": "AQAB", "e": "AQAB"},
			{"kty": "EC", "crv": "P-384", "kid": "k1", "x": ffpfB64(make([]byte, 48)), "y": ffpfB64(make([]byte, 48))},
			offCurve,
			encryption,
		}
		f.idToken = signFFPFIDToken(t, key, "k1", f.claims())
	})
	c := f.client()
	if _, err := exchangeFFPF(c); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	usable := ffpfJWK(key, "k1")
	delete(usable, "use") // use is optional
	f.set(func(f *fakeFFPF) { f.jwks = append(f.jwks, usable) })
	if _, err := exchangeFFPF(c); err != nil {
		t.Fatalf("Exchange: %v", err)
	}
}
