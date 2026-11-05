package auth

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	ffpfMaxBody = 1 << 20
	// ffpfJWKSCacheFor is how long the portal's JWKS is trusted, so most logins
	// make one request to the portal, not two. A key the portal drops is still
	// accepted for up to this long.
	ffpfJWKSCacheFor = 10 * time.Minute
	// ffpfLeeway is how long after its exp an ID token is still accepted, for
	// clocks that do not quite agree.
	ffpfLeeway = 60 * time.Second
)

var (
	// ffpfJWTSegment is one unpadded base64url segment of a compact JWT.
	ffpfJWTSegment = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	// ffpfSub is the form of an FFPF ID subject; it becomes the owner ID ffpf:<sub>.
	ffpfSub = regexp.MustCompile(`^[a-z0-9]{1,64}$`)
	// ffpfStrictB64 refuses padding and non-zero trailing bits, so a segment has one
	// spelling only.
	ffpfStrictB64 = base64.RawURLEncoding.Strict()
)

// ErrFFPFUnavailable means FFPF ID could not be reached or answered with
// something other than a verdict (network error, timeout, 3xx, 5xx, no JWKS).
var ErrFFPFUnavailable = errors.New("auth: ffpf id unavailable")

// FFPFUser is an FFPF ID account, as its verified ID token describes it.
type FFPFUser struct{ Sub, Email, Name string }

// FFPFClient is the "Sign in with FFPF ID" client: the OpenID Connect provider
// run by ffpf-portal, with the authorization code flow and PKCE. Endpoints are
// built from Issuer (no discovery). The client secret goes only to the token
// endpoint, as HTTP Basic credentials (client_secret_basic). The ID token is
// verified here: an ES256 signature by a key of the portal's JWKS, and its
// iss, aud, exp, nonce, email_verified, email and sub. The access token is not
// used.
//
// HTTP should carry a 10s timeout; main sets it. Redirects are never followed
// whatever HTTP says. When Logger is non-nil, the reason for a rejection (a
// claim name or the token endpoint's error code, never the code, verifier,
// secret or a token) is logged at warn level.
type FFPFClient struct {
	HTTP                                        *http.Client
	Issuer, ClientID, ClientSecret, RedirectURI string
	Logger                                      *slog.Logger

	now func() time.Time // time.Now when nil

	// The JWKS by kid (P-256 signing keys only) and when it was fetched.
	mu      sync.Mutex
	keys    map[string]*ecdsa.PublicKey
	fetched time.Time
}

// Exchange trades the authorization code for the user's verified ID token and
// returns who it names. verifier is the PKCE verifier, and redirectURI and
// nonce the values the authorization request carried. It returns
// ErrUnauthorized when the input, the code or the ID token is rejected, and
// ErrFFPFUnavailable for transport and upstream failures. Returned errors
// never contain the code, verifier, client secret or a token.
func (c *FFPFClient) Exchange(ctx context.Context, code, verifier, redirectURI, nonce string) (FFPFUser, error) {
	if code == "" || verifier == "" || nonce == "" || redirectURI != c.RedirectURI {
		return FFPFUser{}, ErrUnauthorized
	}
	idToken, err := c.fetchIDToken(ctx, code, verifier, redirectURI)
	if err != nil {
		return FFPFUser{}, err
	}
	return c.verify(ctx, idToken, nonce)
}

func (c *FFPFClient) issuer() string {
	return strings.TrimSuffix(c.Issuer, "/")
}

func (c *FFPFClient) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

// reject logs why FFPF ID's answer was refused and returns ErrUnauthorized.
// reason is a fixed word (a claim name and the like), never request data.
func (c *FFPFClient) reject(ctx context.Context, reason string, attrs ...any) error {
	if c.Logger != nil {
		c.Logger.WarnContext(ctx, "ffpf id login rejected", append([]any{"reason", reason}, attrs...)...)
	}
	return ErrUnauthorized
}

func (c *FFPFClient) fetchIDToken(ctx context.Context, code, verifier, redirectURI string) (string, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {verifier},
		"redirect_uri":  {redirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.issuer()+"/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", ErrFFPFUnavailable
	}
	// RFC 6749 §2.3.1: the id and secret are form-encoded, then put in the
	// Basic credentials.
	req.SetBasicAuth(url.QueryEscape(c.ClientID), url.QueryEscape(c.ClientSecret))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	status, body, err := c.do(req)
	if err != nil {
		return "", err
	}
	switch {
	case status >= 400 && status <= 499:
		// Only an RFC 6749 error code is logged, and only when it looks like
		// one, so an answer that echoes the request never reaches the log.
		var out struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &out)
		code := out.Error
		if !githubErrorCode.MatchString(code) {
			code = "unrecognized"
		}
		return "", c.reject(ctx, "token_endpoint", "status", status, "ffpf_error", code)
	case status < 200 || status > 299:
		c.unavailable(ctx, "token_status", "status", status)
		return "", ErrFFPFUnavailable
	}
	var out struct {
		IDToken *string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.IDToken == nil || *out.IDToken == "" {
		return "", c.reject(ctx, "id_token")
	}
	return *out.IDToken, nil
}

// verify checks the ID token's form, signature and claims.
func (c *FFPFClient) verify(ctx context.Context, idToken, nonce string) (FFPFUser, error) {
	segments := strings.Split(idToken, ".")
	if len(segments) != 3 {
		return FFPFUser{}, c.reject(ctx, "malformed")
	}
	var decoded [3][]byte
	for i, segment := range segments {
		if !ffpfJWTSegment.MatchString(segment) {
			return FFPFUser{}, c.reject(ctx, "malformed")
		}
		data, err := ffpfStrictB64.DecodeString(segment)
		if err != nil {
			return FFPFUser{}, c.reject(ctx, "malformed")
		}
		decoded[i] = data
	}

	var header struct {
		Alg string  `json:"alg"`
		Typ *string `json:"typ"`
		Kid string  `json:"kid"`
	}
	if err := json.Unmarshal(decoded[0], &header); err != nil {
		return FFPFUser{}, c.reject(ctx, "header")
	}
	// Only ES256, whatever the header says, so neither "none" nor an HMAC
	// keyed with the public key gets in.
	if header.Alg != "ES256" {
		return FFPFUser{}, c.reject(ctx, "alg")
	}
	if header.Typ != nil && *header.Typ != "JWT" {
		return FFPFUser{}, c.reject(ctx, "typ")
	}
	if header.Kid == "" {
		return FFPFUser{}, c.reject(ctx, "kid")
	}
	key, err := c.key(ctx, header.Kid)
	if err != nil {
		return FFPFUser{}, err
	}
	// An ES256 signature is r‖s, 32 bytes each (RFC 7518 §3.4), not ASN.1.
	sig := decoded[2]
	if len(sig) != 64 {
		return FFPFUser{}, c.reject(ctx, "signature")
	}
	digest := sha256.Sum256([]byte(segments[0] + "." + segments[1]))
	r, s := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(key, digest[:], r, s) {
		return FFPFUser{}, c.reject(ctx, "signature")
	}

	var claims struct {
		Iss           string          `json:"iss"`
		Aud           json.RawMessage `json:"aud"`
		Exp           *float64        `json:"exp"`
		Nonce         string          `json:"nonce"`
		Sub           string          `json:"sub"`
		Email         string          `json:"email"`
		EmailVerified json.RawMessage `json:"email_verified"`
		Name          string          `json:"name"`
	}
	if err := json.Unmarshal(decoded[1], &claims); err != nil {
		return FFPFUser{}, c.reject(ctx, "claims")
	}
	if claims.Iss != c.issuer() {
		return FFPFUser{}, c.reject(ctx, "iss")
	}
	if !ffpfAudienceHas(claims.Aud, c.ClientID) {
		return FFPFUser{}, c.reject(ctx, "aud")
	}
	// exp is seconds since 1970; anything beyond 2^53 is not a time a portal
	// would mean, and is kept out of the conversion.
	if claims.Exp == nil || *claims.Exp < 0 || *claims.Exp > 1<<53 {
		return FFPFUser{}, c.reject(ctx, "exp")
	}
	if c.clock().After(time.Unix(int64(*claims.Exp), 0).Add(ffpfLeeway)) {
		return FFPFUser{}, c.reject(ctx, "exp")
	}
	if nonce == "" || claims.Nonce != nonce {
		return FFPFUser{}, c.reject(ctx, "nonce")
	}
	if string(claims.EmailVerified) != "true" {
		return FFPFUser{}, c.reject(ctx, "email_verified")
	}
	if claims.Email == "" {
		return FFPFUser{}, c.reject(ctx, "email")
	}
	if !ffpfSub.MatchString(claims.Sub) {
		return FFPFUser{}, c.reject(ctx, "sub")
	}
	name := strings.TrimSpace(claims.Name)
	if name == "" {
		// The portal's name may be empty; the email's local part stands in.
		name, _, _ = strings.Cut(claims.Email, "@")
	}
	return FFPFUser{Sub: claims.Sub, Email: claims.Email, Name: name}, nil
}

// ffpfAudienceHas reports whether aud, a string or an array of strings
// (RFC 7519 §4.1.3), names clientID.
func ffpfAudienceHas(aud json.RawMessage, clientID string) bool {
	var one string
	if err := json.Unmarshal(aud, &one); err == nil {
		return one == clientID
	}
	var many []string
	if err := json.Unmarshal(aud, &many); err == nil {
		for _, a := range many {
			if a == clientID {
				return true
			}
		}
	}
	return false
}

// key returns the portal's public key of kid. The JWKS is fetched when the
// cache is older than ffpfJWKSCacheFor or lacks kid (the portal may have
// rotated), but at most once per call, so one ID token never makes more than
// one JWKS request. A failed fetch is ErrFFPFUnavailable even when a stale key
// of kid is cached; a kid the fresh JWKS lacks too is ErrUnauthorized.
func (c *FFPFClient) key(ctx context.Context, kid string) (*ecdsa.PublicKey, error) {
	c.mu.Lock()
	key, ok := c.keys[kid]
	fresh := !c.fetched.IsZero() && c.clock().Sub(c.fetched) < ffpfJWKSCacheFor
	c.mu.Unlock()
	if ok && fresh {
		return key, nil
	}
	keys, err := c.fetchJWKS(ctx)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.keys, c.fetched = keys, c.clock()
	c.mu.Unlock()
	if key, ok := keys[kid]; ok {
		return key, nil
	}
	return nil, c.reject(ctx, "kid")
}

// fetchJWKS is GET <issuer>/oauth/jwks. Keys other than P-256 EC signing keys
// with a kid are left out.
func (c *FFPFClient) fetchJWKS(ctx context.Context) (map[string]*ecdsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.issuer()+"/oauth/jwks", nil)
	if err != nil {
		return nil, ErrFFPFUnavailable
	}
	req.Header.Set("Accept", "application/json")
	status, body, err := c.do(req)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		c.unavailable(ctx, "jwks_status", "status", status)
		return nil, ErrFFPFUnavailable
	}
	var out struct {
		Keys *[]struct {
			Kty string `json:"kty"`
			Crv string `json:"crv"`
			Use string `json:"use"`
			Kid string `json:"kid"`
			X   string `json:"x"`
			Y   string `json:"y"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.Keys == nil {
		c.unavailable(ctx, "jwks_body")
		return nil, ErrFFPFUnavailable
	}
	keys := map[string]*ecdsa.PublicKey{}
	for _, k := range *out.Keys {
		if k.Kty != "EC" || k.Crv != "P-256" || k.Kid == "" || (k.Use != "" && k.Use != "sig") {
			continue
		}
		if _, seen := keys[k.Kid]; seen {
			continue
		}
		if key, ok := ffpfP256Key(k.X, k.Y); ok {
			keys[k.Kid] = key
		}
	}
	return keys, nil
}

// unavailable logs why FFPF ID could not be used. reason is a fixed word.
func (c *FFPFClient) unavailable(ctx context.Context, reason string, attrs ...any) {
	if c.Logger != nil {
		c.Logger.WarnContext(ctx, "ffpf id unavailable", append([]any{"reason", reason}, attrs...)...)
	}
}

// ffpfP256Key makes the public key of a JWK's x and y when both are 32 bytes
// and the point is on P-256. crypto/ecdh checks the point; ecdsa.Verify does
// not.
func ffpfP256Key(x64, y64 string) (*ecdsa.PublicKey, bool) {
	x, errX := ffpfStrictB64.DecodeString(x64)
	y, errY := ffpfStrictB64.DecodeString(y64)
	if errX != nil || errY != nil || len(x) != 32 || len(y) != 32 {
		return nil, false
	}
	point := append(append([]byte{0x04}, x...), y...)
	if _, err := ecdh.P256().NewPublicKey(point); err != nil {
		return nil, false
	}
	return &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}, true
}

// do sends req without following redirects (the token request carries the
// client secret) and returns the status and (size-limited) body. The
// transport error is dropped: it can embed request details.
func (c *FFPFClient) do(req *http.Request) (int, []byte, error) {
	client := http.Client{Timeout: 10 * time.Second}
	if c.HTTP != nil {
		client = *c.HTTP
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		c.unavailable(req.Context(), "transport")
		return 0, nil, ErrFFPFUnavailable
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, ffpfMaxBody))
	if err != nil {
		c.unavailable(req.Context(), "body")
		return 0, nil, ErrFFPFUnavailable
	}
	return resp.StatusCode, body, nil
}
