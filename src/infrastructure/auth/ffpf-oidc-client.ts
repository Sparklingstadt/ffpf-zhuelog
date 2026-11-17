// "Sign in with FFPF ID": the OpenID Connect provider run by ffpf-portal,
// with the authorization code flow and PKCE, as Go's FFPFClient
// (services/api/auth/ffpf.go). Endpoints are built from the issuer (no
// discovery). The client secret goes only to the token endpoint, as HTTP
// Basic credentials (client_secret_basic). The ID token is verified here with
// node:crypto: an ES256 signature by a key of FFPF ID's JWKS, then iss, aud,
// exp, nonce, email_verified, email and sub. The access token is not used.
//
// The checks run in the order golang-jwt v5.3.1 and Go's verify run them, and
// every refusal logs Go's reason word. JSON is read as Go's encoding/json
// reads it into Go's structs: a field of the wrong JSON type fails the whole
// read, null leaves a string field empty, and keys match fields ignoring case.
//
// Outcomes: "invalid" when FFPF ID refuses the code or the ID token is not
// acceptable; "unavailable" for transport and upstream failures. Neither the
// result nor the log ever carries the code, verifier, nonce, client secret,
// a token or a claim.
import {
  ECDH,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";

import type {
  ExchangeOutcome,
  FfpfIdentity,
} from "@/application/identity/sign-in";
import {
  FFPF_SUB_PATTERN,
  emailLocalPart,
} from "@/domain/identity/ffpf-account";
import { goTrimSpace } from "@/domain/line/go-text";

import {
  type OAuthLog,
  consoleOAuthLog,
  fetchLimited,
  formUrlEncode,
  loggableOAuthErrorCode,
} from "./oauth-http";

// Go: ffpfJWKSCacheFor. A key FFPF ID drops is still accepted this long.
export const FFPF_JWKS_CACHE_MS = 600_000;
// Go: ffpfLeeway. An ID token is accepted up to and including exp + 60 s.
export const FFPF_LEEWAY_MS = 60_000;

// Go: ffpfJWTSegment. One non-empty unpadded base64url segment.
const JWT_SEGMENT = /^[A-Za-z0-9_-]+$/;

// The algs golang-jwt v5 knows. An unknown alg is refused before the
// signature segment is decoded, a known one other than ES256 after it.
const JWT_KNOWN_ALGS = new Set([
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
  "HS256",
  "HS384",
  "HS512",
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "none",
]);

// Go: errFFPFExpRange. exp outside 0..2^53 seconds is refused.
const MAX_EXP_SECONDS = 2 ** 53;

const P256_COORDINATE_BYTES = 32;
const ES256_SIGNATURE_BYTES = 64;

const INVALID = { ok: false, reason: "invalid" } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;
type Failure = typeof INVALID | typeof UNAVAILABLE;

// Go reads bytes as they are: a byte order mark is not dropped, so JSON that
// starts with one does not parse.
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

// Go: base64.RawURLEncoding.Strict(). No padding, and the unused trailing
// bits zero, so a segment has one spelling only.
function strictBase64Url(text: string): Buffer | null {
  if (!JWT_SEGMENT.test(text)) return null;
  const bytes = Buffer.from(text, "base64url");
  return bytes.toString("base64url") === text ? bytes : null;
}

function parseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Go's encoding/json folds key and field names alike: ASCII letters by
// case, plus the four non-ASCII letters whose simple case mapping is ASCII.
const GO_FOLDS_TO_ASCII: Readonly<Record<string, string>> = {
  İ: "I", // İ
  ı: "I", // ı
  ſ: "S", // ſ
  K: "K", // Kelvin sign
};

function goFold(name: string): string {
  let out = "";
  for (const ch of name) {
    out += ch < "\u0080" ? ch.toUpperCase() : (GO_FOLDS_TO_ASCII[ch] ?? ch);
  }
  return out;
}

// The values of the object's keys that Go matches to the field, in order;
// the last one wins, as Go assigns them in turn.
function goFieldValues(
  object: Record<string, unknown>,
  field: string,
): unknown[] {
  const folded = goFold(field);
  return Object.entries(object)
    .filter(([key]) => goFold(key) === folded)
    .map(([, value]) => value);
}

// A Go string field: null leaves it as it was, another type is an error.
function goString(values: unknown[]): { value: string; bad: boolean } {
  let value = "";
  let bad = false;
  for (const v of values) {
    if (typeof v === "string") value = v;
    else if (v !== null) bad = true;
  }
  return { value, bad };
}

// A Go pointer field: null makes it nil (undefined), accept() says which
// values it can hold.
function goPointer<T>(
  values: unknown[],
  accept: (v: unknown) => v is T,
): { value: T | undefined; bad: boolean } {
  let value: T | undefined;
  let bad = false;
  for (const v of values) {
    if (v === null) value = undefined;
    else if (accept(v)) value = v;
    else bad = true;
  }
  return { value, bad };
}

const isString = (v: unknown): v is string => typeof v === "string";
// Go's float64: a number JSON.parse made infinite does not fit.
const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

// Go: json.Unmarshal into map[string]any fails on a number that does not fit
// a float64, after it has made the map.
function hasInfiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasInfiniteNumber);
  if (isObject(value)) return Object.values(value).some(hasInfiniteNumber);
  return false;
}

// golang-jwt's header (map[string]any). null is a nil map: no error, but no
// alg either. On an error, `made` says whether Go had made the map, which
// decides the logged reason (ffpfRejectReason).
function decodeHeader(
  bytes: Buffer,
):
  | { ok: true; header: Record<string, unknown> | null }
  | { ok: false; made: boolean } {
  const parsed = parseJson(utf8.decode(bytes));
  if (!parsed) return { ok: false, made: false };
  if (parsed.value === null) return { ok: true, header: null };
  if (!isObject(parsed.value)) return { ok: false, made: false };
  if (hasInfiniteNumber(parsed.value)) return { ok: false, made: true };
  return { ok: true, header: parsed.value };
}

// Go: ffpfClaims (auth/ffpf.go:161-170). iat and nbf are not read.
type Claims = {
  iss: string;
  aud: string[];
  exp: number | undefined;
  nonce: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

// jwt.ClaimStrings: a string or an array of strings; null leaves it as it
// was.
function goClaimStrings(values: unknown[]): { value: string[]; bad: boolean } {
  let value: string[] = [];
  let bad = false;
  for (const v of values) {
    if (v === null) continue;
    if (typeof v === "string") value = [v];
    else if (Array.isArray(v) && v.every(isString)) value = v;
    else bad = true;
  }
  return { value, bad };
}

// null when Go could not read the claims into ffpfClaims.
function decodeClaims(bytes: Buffer): Claims | null {
  const parsed = parseJson(utf8.decode(bytes));
  if (!parsed) return null;
  const object = parsed.value === null ? {} : parsed.value;
  if (!isObject(object)) return null;
  const field = (name: string) => goFieldValues(object, name);
  const iss = goString(field("iss"));
  const aud = goClaimStrings(field("aud"));
  const exp = goPointer(field("exp"), isFiniteNumber);
  const nonce = goString(field("nonce"));
  const sub = goString(field("sub"));
  const email = goString(field("email"));
  const name = goString(field("name"));
  if ([iss, aud, exp, nonce, sub, email, name].some((f) => f.bad)) return null;
  return {
    iss: iss.value,
    aud: aud.value,
    exp: exp.value,
    nonce: nonce.value,
    sub: sub.value,
    email: email.value,
    // Go compares the raw JSON with `true`: only the literal true.
    emailVerified: field("email_verified").at(-1) === true,
    name: name.value,
  };
}

// Go: ffpfP256Key. x and y strict base64url of 32 bytes each, and the point
// on P-256 (ECDH.convertKey checks it, as Go's crypto/ecdh does).
function p256Key(x: string, y: string): KeyObject | null {
  const xBytes = strictBase64Url(x);
  const yBytes = strictBase64Url(y);
  if (
    xBytes?.length !== P256_COORDINATE_BYTES ||
    yBytes?.length !== P256_COORDINATE_BYTES
  )
    return null;
  try {
    ECDH.convertKey(
      Buffer.concat([Buffer.from([0x04]), xBytes, yBytes]),
      "prime256v1",
    );
    return createPublicKey({
      key: { kty: "EC", crv: "P-256", x, y },
      format: "jwk",
    });
  } catch {
    return null;
  }
}

const JWK_FIELDS = ["kty", "crv", "use", "kid", "x", "y"] as const;
type Jwk = Record<(typeof JWK_FIELDS)[number], string>;

function decodeJwk(value: unknown): Jwk | null {
  const object = value === null ? {} : value;
  if (!isObject(object)) return null;
  const jwk = {} as Jwk;
  for (const name of JWK_FIELDS) {
    const field = goString(goFieldValues(object, name));
    if (field.bad) return null;
    jwk[name] = field.value;
  }
  return jwk;
}

// Go: fetchJWKS's body. null when it is not JSON, has no keys array, or a
// key's field has the wrong type. Keys other than P-256 EC signing keys with
// a kid are left out, and only the first key of a kid is kept.
function decodeJwks(text: string): Map<string, KeyObject> | null {
  const parsed = parseJson(text);
  if (!parsed || !isObject(parsed.value)) return null;
  const list = goPointer(goFieldValues(parsed.value, "keys"), Array.isArray);
  if (list.bad || list.value === undefined) return null;
  const jwks = list.value.map(decodeJwk);
  if (jwks.some((jwk) => jwk === null)) return null;

  const keys = new Map<string, KeyObject>();
  for (const jwk of jwks as Jwk[]) {
    if (
      jwk.kty !== "EC" ||
      jwk.crv !== "P-256" ||
      jwk.kid === "" ||
      (jwk.use !== "" && jwk.use !== "sig") ||
      keys.has(jwk.kid)
    )
      continue;
    const key = p256Key(jwk.x, jwk.y);
    if (key) keys.set(jwk.kid, key);
  }
  return keys;
}

// Go: fetchIDToken's success body. The id_token when it is a non-empty
// string, else null.
function decodeIdToken(text: string): string | null {
  const parsed = parseJson(text);
  if (!parsed || !isObject(parsed.value)) return null;
  const idToken = goPointer(goFieldValues(parsed.value, "id_token"), isString);
  return !idToken.bad && idToken.value ? idToken.value : null;
}

// Go: fetchIDToken's error body; its errors are ignored.
function decodeErrorCode(text: string): string {
  const parsed = parseJson(text);
  if (!parsed || !isObject(parsed.value)) return "";
  return goString(goFieldValues(parsed.value, "error")).value;
}

export function createFfpfOidcClient(config: {
  issuer: string; // trailing slashes dropped
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch; // tests
  now?: () => Date; // tests
  log?: OAuthLog;
}) {
  const fetchFn = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  const log = config.log ?? consoleOAuthLog;
  const issuer = config.issuer.replace(/\/+$/, "");
  const tokenUrl = `${issuer}/oauth/token`;
  const jwksUrl = `${issuer}/oauth/jwks`;
  // RFC 6749 §2.3.1: the id and secret are form-encoded, then put in the
  // Basic credentials.
  const basic = Buffer.from(
    `${formUrlEncode(config.clientId)}:${formUrlEncode(config.clientSecret)}`,
  ).toString("base64");

  // The JWKS by kid and when it was fetched; one per client object, so the
  // composition makes one client per instance (Go: one per process).
  let cachedKeys = new Map<string, KeyObject>();
  let fetchedAt: number | undefined;

  // Go: reject. reason is a fixed word, never request data.
  function reject(
    reason: string,
    fields: Record<string, string | number> = {},
  ): typeof INVALID {
    log("FFPF_ID_REJECTED", { reason, ...fields });
    return INVALID;
  }

  // Go: unavailable.
  function unavailable(
    reason: string,
    fields: Record<string, string | number> = {},
  ): typeof UNAVAILABLE {
    log("FFPF_ID_UNAVAILABLE", { reason, ...fields });
    return UNAVAILABLE;
  }

  // Go: fetchIDToken.
  async function fetchIdToken(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<string | Failure> {
    // Go: url.Values.Encode, keys sorted.
    const body = [
      ["code", code],
      ["code_verifier", verifier],
      ["grant_type", "authorization_code"],
      ["redirect_uri", redirectUri],
    ]
      .map(([k, v]) => `${formUrlEncode(k!)}=${formUrlEncode(v!)}`)
      .join("&");
    const response = await fetchLimited(fetchFn, tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    if (response === "unavailable") return unavailable("transport");
    const { status, text } = response;
    if (status >= 400 && status <= 499) {
      // Only an RFC 6749 error code is logged, and only when it looks like
      // one, so an answer that echoes the request never reaches the log.
      return reject("token_endpoint", {
        status,
        ffpf_error: loggableOAuthErrorCode(decodeErrorCode(text)),
      });
    }
    // 3xx included: redirects are never followed.
    if (status < 200 || status > 299)
      return unavailable("token_status", { status });
    return decodeIdToken(text) ?? reject("id_token");
  }

  // Go: fetchJWKS.
  async function fetchJwks(): Promise<Map<string, KeyObject> | Failure> {
    const response = await fetchLimited(fetchFn, jwksUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response === "unavailable") return unavailable("transport");
    if (response.status !== 200)
      return unavailable("jwks_status", { status: response.status });
    return decodeJwks(response.text) ?? unavailable("jwks_body");
  }

  // Go: key. The JWKS is fetched when the cache is older than 10 minutes or
  // lacks kid (FFPF ID may have rotated), but at most once per ID token. A
  // failed fetch is unavailable even when a stale key of kid is cached; a
  // kid the fresh JWKS lacks too is refused.
  async function keyFor(kid: string): Promise<{ key: KeyObject } | Failure> {
    const cached = cachedKeys.get(kid);
    const fresh =
      fetchedAt !== undefined &&
      now().getTime() - fetchedAt < FFPF_JWKS_CACHE_MS;
    if (cached && fresh) return { key: cached };
    const keys = await fetchJwks();
    if (!(keys instanceof Map)) return keys;
    cachedKeys = keys;
    fetchedAt = now().getTime();
    const key = keys.get(kid);
    return key ? { key } : reject("kid");
  }

  // Go: verify, with golang-jwt's ParseWithClaims (WithValidMethods ES256,
  // WithIssuer, WithAudience, WithExpirationRequired, WithLeeway,
  // WithStrictDecoding) in its order.
  async function verify(
    idToken: string,
    nonce: string,
  ): Promise<ExchangeOutcome<FfpfIdentity>> {
    // Three non-empty base64url segments, so an unsigned "header.claims."
    // is malformed rather than a wrong alg.
    const segments = idToken.split(".");
    if (
      segments.length !== 3 ||
      !segments.every((segment) => JWT_SEGMENT.test(segment))
    )
      return reject("malformed");
    const [headerSegment, claimsSegment, signatureSegment] = segments as [
      string,
      string,
      string,
    ];

    const headerBytes = strictBase64Url(headerSegment);
    if (!headerBytes) return reject("malformed");
    const decodedHeader = decodeHeader(headerBytes);
    if (!decodedHeader.ok)
      return reject(decodedHeader.made ? "claims" : "header");
    const header = decodedHeader.header ?? {};

    const claimsBytes = strictBase64Url(claimsSegment);
    if (!claimsBytes) return reject("malformed");
    const claims = decodeClaims(claimsBytes);
    if (!claims)
      return reject(decodedHeader.header === null ? "header" : "claims");

    const { alg, typ, kid } = header;
    if (typeof alg !== "string" || !JWT_KNOWN_ALGS.has(alg))
      return reject("alg");
    const signature = strictBase64Url(signatureSegment);
    if (!signature) return reject("malformed");
    // Neither "none" nor an HMAC keyed with the public key gets in.
    if (alg !== "ES256") return reject("alg");

    if (typ !== undefined && typ !== null && typ !== "JWT")
      return reject("typ");
    if (typeof kid !== "string" || kid === "") return reject("kid");
    const found = await keyFor(kid);
    if (!("key" in found)) return found;

    // ES256: ECDSA P-256 over SHA-256 of header.claims, r‖s of 32 bytes
    // each.
    if (
      signature.length !== ES256_SIGNATURE_BYTES ||
      !verifyEs256(`${headerSegment}.${claimsSegment}`, found.key, signature)
    )
      return reject("signature");

    // golang-jwt checks exp, aud and iss together; Go names them in the
    // order iss, aud, exp.
    if (claims.iss !== issuer) return reject("iss");
    const { aud } = claims;
    if (
      aud.length === 0 ||
      (aud.length === 1 && aud[0] === "") ||
      !aud.includes(config.clientId)
    )
      return reject("aud");
    const { exp } = claims;
    if (
      exp === undefined ||
      exp < 0 ||
      exp > MAX_EXP_SECONDS ||
      // time.Unix(int64(exp)) drops the fraction.
      now().getTime() > Math.trunc(exp) * 1000 + FFPF_LEEWAY_MS
    )
      return reject("exp");

    if (claims.nonce !== nonce) return reject("nonce");
    if (!claims.emailVerified) return reject("email_verified");
    if (claims.email === "") return reject("email");
    if (!FFPF_SUB_PATTERN.test(claims.sub)) return reject("sub");
    // FFPF ID's name may be empty; the email's local part stands in. The
    // sign-in trims and shortens it again for the display name.
    const name = goTrimSpace(claims.name) || emailLocalPart(claims.email);
    return { ok: true, user: { sub: claims.sub, email: claims.email, name } };
  }

  return {
    // Go: FFPFClient.Exchange. verifier is the PKCE verifier; redirectUri
    // and nonce are the values the authorize request carried. Empty code,
    // verifier or nonce is refused without calling FFPF ID.
    async exchange(
      code: string,
      verifier: string,
      redirectUri: string,
      nonce: string,
    ): Promise<ExchangeOutcome<FfpfIdentity>> {
      if (code === "" || verifier === "" || nonce === "") return INVALID;
      const idToken = await fetchIdToken(code, verifier, redirectUri);
      if (typeof idToken !== "string") return idToken;
      return verify(idToken, nonce);
    },
  };
}

function verifyEs256(
  signingInput: string,
  key: KeyObject,
  signature: Buffer,
): boolean {
  try {
    return verifySignature(
      "sha256",
      Buffer.from(signingInput, "ascii"),
      { key, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return false;
  }
}
