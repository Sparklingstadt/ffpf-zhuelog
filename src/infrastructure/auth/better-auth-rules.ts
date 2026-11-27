// The decisions behind the Better Auth configuration (better-auth.ts), kept
// pure so they can be tested without a database or a request.

import { normalizeLoginId } from "@/domain/identity/password-account";

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

// An administrator may impersonate members only: a guest (anonymous user) is
// refused. A target that does not exist is left to the admin plugin.
export function rejectsGuestImpersonation(
  path: string,
  target: { isAnonymous?: boolean | null } | null,
): boolean {
  return path === "/admin/impersonate-user" && target?.isAnonymous === true;
}

// Members have no mail address, but Better Auth's user.email is required and
// unique: an address under .invalid, which can never receive mail.
export function memberEmail(loginId: string): string {
  return `${loginId}@members.zhuelog.invalid`;
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
const SESSION_COOKIE =
  /^(__Secure-)?better-auth\.(session_token|session_data)$/;

// A Cookie request header without Better Auth's session cookies. A sign-in
// must not read the browser's previous session: in better-auth 1.7 the
// anonymous plugin's after-hook reads it, and when it names a session that
// is gone (signed out elsewhere, expired, revoked) the plugin deletes the
// session cookie, replacing the one the sign-in has just set, so the sign-in
// would answer 200 and leave the browser signed out.
export function withoutSessionCookie(header: string | null): string {
  return (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !SESSION_COOKIE.test(part.split("=")[0]))
    .join("; ");
}
