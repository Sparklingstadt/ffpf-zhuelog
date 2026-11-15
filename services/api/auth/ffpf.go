package auth

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
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

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/httpclient"
	"github.com/golang-jwt/jwt/v5"
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
		return "", c.reject(ctx, "token_endpoint", "status", status, "ffpf_error", loggableOAuthErrorCode(out.Error))
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

// ffpfClaims are the ID token claims read here. exp is a plain number (not
// jwt.NumericDate, which also takes a numeric string), so "exp":"9999999999"
// is refused as unreadable claims. nbf and iat are not read.
type ffpfClaims struct {
	Iss           string           `json:"iss"`
	Aud           jwt.ClaimStrings `json:"aud"`
	Exp           *float64         `json:"exp"`
	Nonce         string           `json:"nonce"`
	Sub           string           `json:"sub"`
	Email         string           `json:"email"`
	EmailVerified json.RawMessage  `json:"email_verified"`
	Name          string           `json:"name"`
}

// errFFPFExpRange is an exp outside 0..2^53 seconds: not a time a portal would
// mean, and kept out of the conversion.
var errFFPFExpRange = errors.New("auth: ffpf exp out of range")

func (cl *ffpfClaims) GetExpirationTime() (*jwt.NumericDate, error) {
	if cl.Exp == nil {
		return nil, nil
	}
	if *cl.Exp < 0 || *cl.Exp > 1<<53 {
		return nil, errFFPFExpRange
	}
	return jwt.NewNumericDate(time.Unix(int64(*cl.Exp), 0)), nil
}
func (cl *ffpfClaims) GetIssuedAt() (*jwt.NumericDate, error)  { return nil, nil }
func (cl *ffpfClaims) GetNotBefore() (*jwt.NumericDate, error) { return nil, nil }
func (cl *ffpfClaims) GetIssuer() (string, error)              { return cl.Iss, nil }
func (cl *ffpfClaims) GetSubject() (string, error)             { return cl.Sub, nil }
func (cl *ffpfClaims) GetAudience() (jwt.ClaimStrings, error)  { return cl.Aud, nil }

// ffpfHeaderReject is a header check the Keyfunc failed; its value is the
// reason that is logged.
type ffpfHeaderReject string

func (r ffpfHeaderReject) Error() string { return "auth: ffpf id token header: " + string(r) }

// verify checks the ID token's form, signature and claims. golang-jwt checks
// alg (ES256 only, so neither "none" nor an HMAC keyed with the public key
// gets in), the signature, iss, aud and exp; the Keyfunc checks typ and kid;
// the rest is checked here.
func (c *FFPFClient) verify(ctx context.Context, idToken, nonce string) (FFPFUser, error) {
	// Three non-empty base64url segments, before the library sees it, so an
	// unsigned "header.claims." is malformed rather than a wrong alg.
	segments := strings.Split(idToken, ".")
	if len(segments) != 3 {
		return FFPFUser{}, c.reject(ctx, "malformed")
	}
	for _, segment := range segments {
		if !ffpfJWTSegment.MatchString(segment) {
			return FFPFUser{}, c.reject(ctx, "malformed")
		}
	}

	var claims ffpfClaims
	var keyErr error // what c.key returned; it has already logged
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodES256.Alg()}),
		jwt.WithIssuer(c.issuer()),
		jwt.WithAudience(c.ClientID),
		jwt.WithExpirationRequired(),
		// golang-jwt accepts while now < exp+leeway; a token is accepted up to
		// and including exp+ffpfLeeway, so one more nanosecond.
		jwt.WithLeeway(ffpfLeeway+time.Nanosecond),
		jwt.WithTimeFunc(c.clock),
		jwt.WithStrictDecoding(),
	)
	token, err := parser.ParseWithClaims(idToken, &claims, func(token *jwt.Token) (any, error) {
		if typ := token.Header["typ"]; typ != nil && typ != "JWT" {
			return nil, ffpfHeaderReject("typ")
		}
		kid, _ := token.Header["kid"].(string)
		if kid == "" {
			return nil, ffpfHeaderReject("kid")
		}
		key, err := c.key(ctx, kid)
		if err != nil {
			keyErr = err
			return nil, err
		}
		return key, nil
	})
	if keyErr != nil {
		return FFPFUser{}, keyErr
	}
	if err != nil {
		return FFPFUser{}, c.reject(ctx, ffpfRejectReason(err, token, &claims))
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

// ffpfRejectReason names, as the fixed word that is logged, what golang-jwt
// refused. Claim checks are named in the order iss, aud, exp.
func ffpfRejectReason(err error, token *jwt.Token, claims *ffpfClaims) string {
	var header ffpfHeaderReject
	var corrupt base64.CorruptInputError
	switch {
	case errors.As(err, &header):
		return string(header)
	case errors.Is(err, jwt.ErrTokenMalformed):
		switch {
		case errors.As(err, &corrupt):
			return "malformed"
		case token == nil || token.Header == nil:
			return "header"
		default:
			return "claims"
		}
	case errors.Is(err, jwt.ErrTokenSignatureInvalid):
		if errors.Is(err, jwt.ErrECDSAVerification) {
			return "signature"
		}
		return "alg" // not ES256
	case errors.Is(err, jwt.ErrTokenUnverifiable):
		return "alg" // alg missing or unknown
	case errors.Is(err, jwt.ErrTokenInvalidClaims):
		missing := errors.Is(err, jwt.ErrTokenRequiredClaimMissing)
		switch {
		case errors.Is(err, jwt.ErrTokenInvalidIssuer) || missing && claims.Iss == "":
			return "iss"
		case errors.Is(err, jwt.ErrTokenInvalidAudience) || missing && (len(claims.Aud) == 0 || len(claims.Aud) == 1 && claims.Aud[0] == ""):
			return "aud"
		case errors.Is(err, jwt.ErrTokenExpired) || errors.Is(err, errFFPFExpRange) || missing && claims.Exp == nil:
			return "exp"
		}
	}
	return "claims"
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
	resp, err := httpclient.NoRedirect(c.HTTP, 10*time.Second).Do(req)
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
