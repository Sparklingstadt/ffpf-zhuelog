import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// GitHub sign-in through the Go API: the web keeps PKCE and state in the
// zl_oauth cookie, and Go exchanges the code. The redirect URI must be the
// same string in the authorize step and in the code exchange, so both build
// it from requestOrigin -> publicOrigin -> githubRedirectUri.

export const GITHUB_CALLBACK_PATH = "/api/auth/callback/github/go";
export const OAUTH_COOKIE_MAX_AGE = 600;

export type OAuthState = {
  state: string;
  verifier: string;
  callbackPath: string;
};

export function githubRedirectUri(origin: string): string {
  return `${origin}${GITHUB_CALLBACK_PATH}`;
}

// The origin the browser used, from the request headers (Vercel sets
// x-forwarded-proto and host).
export function requestOrigin(requestHeaders: Headers): string {
  const first = (name: string) =>
    requestHeaders.get(name)?.split(",")[0]?.trim() || undefined;
  const proto = first("x-forwarded-proto") ?? "http";
  const host = first("x-forwarded-host") ?? first("host") ?? "localhost";
  return `${proto}://${host}`;
}

// AUTH_URL states the public origin when set; any path in it is ignored.
export function publicOrigin(fallback: string): string {
  const configured = process.env.AUTH_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed AUTH_URL falls back to the request's origin.
    }
  }
  return fallback;
}

// PKCE S256 (RFC 7636): the verifier is a one-time random value, not a
// password, so a single SHA-256 is what the spec requires.
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createOAuthStart(callbackPath: string): {
  state: string;
  verifier: string;
  challenge: string;
  cookieValue: string;
} {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = pkceChallenge(verifier);
  const cookieValue = Buffer.from(
    JSON.stringify({ state, verifier, callbackPath }),
  ).toString("base64url");
  return { state, verifier, challenge, cookieValue };
}

export function parseOAuthCookie(value: string | undefined): OAuthState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const { state, verifier, callbackPath } = parsed as Record<string, unknown>;
    if (
      typeof state !== "string" ||
      !state ||
      typeof verifier !== "string" ||
      !verifier ||
      typeof callbackPath !== "string"
    )
      return null;
    return { state, verifier, callbackPath };
  } catch {
    return null;
  }
}

// Constant-time comparison of the state GitHub sent back with the cookie's.
export function isSameState(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function githubAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
