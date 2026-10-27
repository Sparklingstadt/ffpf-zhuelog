import { randomBytes } from "node:crypto";

import { pkceChallenge } from "./github-oauth";

// FFPF ID sign-in through the Go API, the same shape as github-oauth.ts plus
// an OIDC nonce. The web keeps PKCE, state and nonce in the zl_oauth cookie
// with provider "ffpf", so a GitHub start never finishes here and an FFPF
// start never finishes at the GitHub callback. Go exchanges the code and
// checks the ID token's nonce. The redirect URI is built from
// requestOrigin -> publicOrigin -> ffpfRedirectUri in both steps.

export const FFPF_CALLBACK_PATH = "/api/auth/callback/ffpf";

export type FfpfOAuthState = {
  state: string;
  verifier: string;
  nonce: string;
  callbackPath: string;
  provider: "ffpf";
};

export function ffpfRedirectUri(origin: string): string {
  return `${origin}${FFPF_CALLBACK_PATH}`;
}

// The endpoints are built from the issuer; discovery is not used.
export function ffpfAuthorizeUrl(input: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  nonce: string;
}): string {
  const url = new URL(`${input.issuer.replace(/\/+$/, "")}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("nonce", input.nonce);
  return url.toString();
}

export function createFfpfOAuthStart(callbackPath: string): {
  state: string;
  verifier: string;
  challenge: string;
  nonce: string;
  cookieValue: string;
} {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const challenge = pkceChallenge(verifier);
  const saved: FfpfOAuthState = {
    state,
    verifier,
    nonce,
    callbackPath,
    provider: "ffpf",
  };
  const cookieValue = Buffer.from(JSON.stringify(saved)).toString("base64url");
  return { state, verifier, challenge, nonce, cookieValue };
}

// Null for anything but an FFPF start, including GitHub's zl_oauth value
// (which carries no provider).
export function parseFfpfOAuthCookie(
  value: string | undefined,
): FfpfOAuthState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const { provider, state, verifier, nonce, callbackPath } = parsed as Record<
      string,
      unknown
    >;
    if (
      provider !== "ffpf" ||
      typeof state !== "string" ||
      !state ||
      typeof verifier !== "string" ||
      !verifier ||
      typeof nonce !== "string" ||
      !nonce ||
      typeof callbackPath !== "string"
    )
      return null;
    return { state, verifier, nonce, callbackPath, provider };
  } catch {
    return null;
  }
}
