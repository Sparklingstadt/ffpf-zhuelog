// "Sign in with Sparklingstadt ID": the OpenID Connect provider run by
// sparklingstadt-id, with the authorization code flow and PKCE. Endpoints are
// built from the issuer (no discovery). The client secret goes only to the
// token endpoint, as HTTP Basic credentials (client_secret_basic). The access
// token is not used.
//
// The ID token is verified with jose: an ES256 signature by a key of
// Sparklingstadt ID's JWKS, then iss, aud and exp. typ, nonce,
// email_verified, email and sub are checked here. Both requests go through
// fetchLimited (no redirects, 10 s, 1 MiB), so jose is given the JWKS as a
// local key set and never fetches anything itself.
//
// Outcomes: "invalid" when Sparklingstadt ID refuses the code or the ID token
// is not acceptable; "unavailable" for transport and upstream failures.
// Neither the result nor the log ever carries the code, verifier, nonce,
// client secret, a token or a claim.
import {
  type JSONWebKeySet,
  type JWTVerifyGetKey,
  type LocalJWKSet,
  createLocalJWKSet,
  errors,
  jwtVerify,
} from "jose";

import type {
  ExchangeOutcome,
  SidIdentity,
} from "@/application/identity/sign-in";
import { SID_SUB_PATTERN, emailLocalPart } from "@/domain/identity/sid-account";
import { trimWhiteSpace } from "@/domain/line/white-space";

import {
  type OAuthLog,
  consoleOAuthLog,
  fetchLimited,
  formUrlEncode,
  loggableOAuthErrorCode,
} from "./oauth-http";

// A key Sparklingstadt ID drops is still accepted this long.
export const SID_JWKS_CACHE_MS = 600_000;
// An ID token is accepted until 60 s after its exp.
export const SID_LEEWAY_MS = 60_000;

const INVALID = { ok: false, reason: "invalid" } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;
type Failure = typeof INVALID | typeof UNAVAILABLE;

// Thrown inside jose's key lookup when the JWKS cannot be fetched or read.
// The reason is logged where it is thrown.
class JwksUnavailable extends Error {}

// The claims jose checks; a refusal over one of them logs its name.
const JOSE_CHECKED_CLAIMS = new Set(["iss", "aud", "exp", "nbf", "iat"]);

// The logged word for an ID token jose refused. Always one of these fixed
// words: jose's own messages and the token's contents are never logged.
function refusalReason(error: unknown): string {
  if (error instanceof errors.JOSEAlgNotAllowed) return "alg";
  if (
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys
  )
    return "kid";
  if (error instanceof errors.JWSSignatureVerificationFailed)
    return "signature";
  if (error instanceof errors.JWTExpired) return "exp";
  if (error instanceof errors.JWTClaimValidationFailed)
    return JOSE_CHECKED_CLAIMS.has(error.claim) ? error.claim : "claims";
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid)
    return "malformed";
  // A key of the JWKS that cannot be used, or a header jose does not support.
  return "unverifiable";
}

// The members of a JSON object; none when text is anything else.
function jsonObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createSidOidcClient(config: {
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

  // The JWKS and when it was fetched; one per client object, so the
  // composition makes one client per instance.
  let jwks: { keySet: LocalJWKSet; fetchedAt: number } | undefined;

  // Logs a refusal. reason is a fixed word, never request data.
  function reject(
    reason: string,
    fields: Record<string, string | number> = {},
  ): typeof INVALID {
    log("SID_REJECTED", { reason, ...fields });
    return INVALID;
  }

  // Logs an upstream failure the same way.
  function unavailable(
    reason: string,
    fields: Record<string, string | number> = {},
  ): typeof UNAVAILABLE {
    log("SID_UNAVAILABLE", { reason, ...fields });
    return UNAVAILABLE;
  }

  // Trades the code for the ID token at the token endpoint.
  async function fetchIdToken(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<string | Failure> {
    // Form-encoded, with the keys in alphabetical order.
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
        sid_error: loggableOAuthErrorCode(jsonObject(text).error),
      });
    }
    // 3xx included: redirects are never followed.
    if (status < 200 || status > 299)
      return unavailable("token_status", { status });
    const idToken = jsonObject(text).id_token;
    return typeof idToken === "string" && idToken !== ""
      ? idToken
      : reject("id_token");
  }

  // Fetches the JWKS and hands it to jose as a local key set.
  async function fetchJwks(): Promise<LocalJWKSet> {
    const failed = (
      reason: string,
      fields: Record<string, string | number> = {},
    ) => {
      unavailable(reason, fields);
      return new JwksUnavailable();
    };
    const response = await fetchLimited(fetchFn, jwksUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response === "unavailable") throw failed("transport");
    if (response.status !== 200)
      throw failed("jwks_status", { status: response.status });
    try {
      // jose refuses anything but an object with a keys array of objects.
      return createLocalJWKSet(JSON.parse(response.text) as JSONWebKeySet);
    } catch {
      throw failed("jwks_body");
    }
  }

  // The key for an ID token's header. The JWKS is fetched when the cache is
  // older than 10 minutes or has no key for the kid (Sparklingstadt ID may
  // have rotated), but at most once per ID token. A failed fetch is
  // unavailable even when a stale key of the kid is cached; a kid the fresh
  // JWKS lacks too is refused.
  const keyFor: JWTVerifyGetKey = async (header, token) => {
    // A kid is required: without one jose would take the JWKS's only key.
    if (typeof header.kid !== "string" || header.kid === "")
      throw new errors.JWKSNoMatchingKey();
    if (jwks && now().getTime() - jwks.fetchedAt < SID_JWKS_CACHE_MS) {
      try {
        return await jwks.keySet(header, token);
      } catch (error) {
        if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
      }
    }
    jwks = { keySet: await fetchJwks(), fetchedAt: now().getTime() };
    return jwks.keySet(header, token);
  };

  // Verifies the ID token and reads the user from it. jose checks alg before
  // it asks for a key, so a token of another alg never causes a JWKS fetch.
  async function verify(
    idToken: string,
    nonce: string,
  ): Promise<ExchangeOutcome<SidIdentity>> {
    let verified;
    try {
      verified = await jwtVerify(idToken, keyFor, {
        // Neither "none" nor an HMAC keyed with the public key gets in.
        algorithms: ["ES256"],
        issuer,
        audience: config.clientId,
        requiredClaims: ["exp"],
        clockTolerance: SID_LEEWAY_MS / 1000,
        currentDate: now(),
      });
    } catch (error) {
      if (error instanceof JwksUnavailable) return UNAVAILABLE;
      return reject(refusalReason(error));
    }
    const { payload, protectedHeader } = verified;
    // typ may be left out, but another kind of JWT signed with the same key
    // is not an ID token.
    if (protectedHeader.typ !== undefined && protectedHeader.typ !== "JWT")
      return reject("typ");
    if (payload.nonce !== nonce) return reject("nonce");
    // Only the JSON literal true counts.
    if (payload.email_verified !== true) return reject("email_verified");
    const { sub, email, name } = payload;
    if (typeof email !== "string" || email === "") return reject("email");
    if (typeof sub !== "string" || !SID_SUB_PATTERN.test(sub))
      return reject("sub");
    // Sparklingstadt ID's name may be empty; the email's local part stands
    // in. The sign-in trims and shortens it again for the display name.
    const displayName =
      (typeof name === "string" && trimWhiteSpace(name)) ||
      emailLocalPart(email);
    return { ok: true, user: { sub, email, name: displayName } };
  }

  return {
    // verifier is the PKCE verifier; redirectUri
    // and nonce are the values the authorize request carried. Empty code,
    // verifier or nonce is refused without calling Sparklingstadt ID.
    async exchange(
      code: string,
      verifier: string,
      redirectUri: string,
      nonce: string,
    ): Promise<ExchangeOutcome<SidIdentity>> {
      if (code === "" || verifier === "" || nonce === "") return INVALID;
      const idToken = await fetchIdToken(code, verifier, redirectUri);
      if (typeof idToken !== "string") return idToken;
      return verify(idToken, nonce);
    },
  };
}
