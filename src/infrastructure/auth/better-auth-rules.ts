// The decisions behind the Better Auth configuration (better-auth.ts), kept
// pure so they can be tested without a database or a request.

import { normalizeLoginId } from "@/domain/identity/password-account";

export { memberEmail } from "@/domain/identity/password-account";
export { isAdminRole } from "@/domain/identity/roles";

// What the username plugin does to a typed login id before it checks and
// looks it up: trim(), then toLowerCase(), as normalizeLoginId does, so
// "Alice" and " alice" still sign in as alice.
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

// A login id as the username plugin checks it, after normalizeUsername:
// already in the stored form of ^[a-z0-9._-]{3,32}$. The plugin's own default
// (^[a-zA-Z0-9_.]+$, at most 30) also applies at sign-in, so without this a
// member whose id has '-' or 31 to 32 characters could not sign in.
export function isAllowedUsername(username: string): boolean {
  return normalizeLoginId(username) === username;
}

// The demo account's password must stay DEMO_PASSWORD: if it changed, nobody
// else could enter the demo that day. Only /change-password is refused, and
// only for the demo account; without DEMO_LOGIN_ID there is no demo.
export function rejectsDemoPasswordChange(
  path: string,
  username: string | null | undefined,
  demoLoginId: string | undefined,
): boolean {
  return (
    path === "/change-password" &&
    demoLoginId !== undefined &&
    username === demoLoginId
  );
}

// While an admin impersonates a member, the member's password is not the
// admin's to change (and a change would hand the admin an ordinary session
// of the member's, outside the impersonation).
export function rejectsImpersonatedPasswordChange(
  path: string,
  impersonatedBy: string | null | undefined,
): boolean {
  return path === "/change-password" && Boolean(impersonatedBy);
}

// An administrator may impersonate members only: a guest (anonymous user) is
// refused. A target that does not exist is left to the admin plugin. Only
// asked for an admin caller (isAdminRole), so nobody else learns whether an
// id is a guest's.
export function rejectsGuestImpersonation(
  path: string,
  target: { isAnonymous?: boolean | null } | null,
): boolean {
  return path === "/admin/impersonate-user" && target?.isAnonymous === true;
}

// Better Auth's rate limit, the only sign-in throttle. Stored in the database
// (the rateLimit table) so it holds across Vercel's serverless instances.
// Server-side auth.api calls are not counted; sign-in goes through HTTP.
// `enabled` is left to Better Auth's default (on in production).
export const AUTH_RATE_LIMIT = {
  storage: "database",
  window: 60,
  max: 10,
  customRules: {
    "/sign-in/username": { window: 900, max: 20 },
    "/change-password": { window: 900, max: 5 },
  },
} as const;

// The endpoints that answer with a new session cookie: a member's or the
// demo's password sign-in, a guest's, and the OAuth callback
// (Sparklingstadt ID). /sign-in/social only sends the browser away.
export function startsSession(path: string): boolean {
  return (
    path === "/sign-in/username" ||
    path === "/sign-in/anonymous" ||
    path.startsWith("/callback/")
  );
}

// Better Auth's session cookies (the token and its cache, with or without
// the __Secure- prefix).
const SESSION_TOKEN_COOKIE = /^(__Secure-)?better-auth\.session_token$/;
const SESSION_COOKIE =
  /^(__Secure-)?better-auth\.(session_token|session_data)$/;

// A Cookie request header without Better Auth's session cookies, for the
// sign-in endpoints (startsSession): see the before-hook in better-auth.ts
// for the better-auth 1.7.28 bug this works around.
export function withoutSessionCookie(header: string | null): string {
  return (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !SESSION_COOKIE.test(part.split("=")[0]))
    .join("; ");
}

// The Cookie request header with Better Auth's session cookies replaced by the
// session token a response has just set (its Set-Cookie headers), or null
// when the response set none: the session a following server-side call in
// the same request should act on (stopping an impersonation, then signing
// the admin out).
export function withSessionCookieFrom(
  header: string | null,
  setCookies: string[],
): string | null {
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";")[0]!.trim();
    const at = pair.indexOf("=");
    if (at < 1) continue;
    const name = pair.slice(0, at);
    if (SESSION_TOKEN_COOKIE.test(name) && pair.slice(at + 1) !== "")
      return [withoutSessionCookie(header), pair].filter(Boolean).join("; ");
  }
  return null;
}
