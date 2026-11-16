import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies the HS256 access tokens issued by the Go API
// (services/api/auth/token.go, Signer.Verify). It must accept and reject
// exactly what Go does.

const ISSUER = "ffpf-zhuelog-api";
const AUDIENCE = "ffpf-zhuelog-mobile";
const MIN_SECRET_BYTES = 32;

export type AccessClaims =
  | { role: "admin"; ownerId: string; login: string }
  | { role: "member"; ownerId: string; sessionVersion: number }
  | { role: "guest"; ownerId: "guest" };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJson(part: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return undefined;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function hasSignature(
  signingInput: string,
  signature: string,
  secret: string,
): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(signingInput).digest();
  const actual = Buffer.from(signature, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hasAudience(aud: unknown): boolean {
  if (typeof aud === "string") return aud === AUDIENCE;
  return (
    Array.isArray(aud) &&
    aud.every((item) => typeof item === "string") &&
    aud.includes(AUDIENCE)
  );
}

// Returns the numeric date claim, undefined when absent, NaN when malformed.
function numericDate(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

// Returns the claims for a valid access token, or null for any failure.
export function verifyAccessToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): AccessClaims | null {
  if (Buffer.byteLength(secret) < MIN_SECRET_BYTES) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts;

  const header = decodeJson(headerPart);
  if (!isObject(header) || header.alg !== "HS256") return null;
  if (!hasSignature(`${headerPart}.${payloadPart}`, signature, secret))
    return null;

  const payload = decodeJson(payloadPart);
  if (!isObject(payload)) return null;

  // Times are compared in seconds with no leeway, as Go does.
  const nowSec = now.getTime() / 1000;
  const exp = numericDate(payload.exp);
  if (exp === undefined || Number.isNaN(exp) || !(nowSec < exp)) return null;
  const iat = numericDate(payload.iat);
  if (iat === undefined || Number.isNaN(iat) || nowSec < iat) return null;
  const nbf = numericDate(payload.nbf);
  if (nbf !== undefined && (Number.isNaN(nbf) || nowSec < nbf)) return null;

  if (payload.iss !== ISSUER || !hasAudience(payload.aud)) return null;

  const sub = payload.sub;
  if (typeof sub !== "string" || sub === "") return null;

  switch (payload.role) {
    case "admin":
      if (typeof payload.login !== "string" || payload.login === "")
        return null;
      return { role: "admin", ownerId: sub, login: payload.login };
    case "member": {
      const sv = payload.sv;
      if (typeof sv !== "number" || !Number.isInteger(sv) || sv < 0)
        return null;
      return { role: "member", ownerId: sub, sessionVersion: sv };
    }
    case "guest":
      return sub === "guest" ? { role: "guest", ownerId: "guest" } : null;
    default:
      return null;
  }
}
