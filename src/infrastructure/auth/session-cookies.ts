import type { IssuedSession } from "@/application/identity/sign-in";

// The web's own session cookies (stage 11 of the Go retirement). This module
// stays free of next/headers so the proxy can import its names.

// Holds the random token whose SHA-256 is a Session row.
export const SESSION_COOKIE = "zl_session";
// The member ownerId an admin acts as; SessionCurrentUserProvider checks it on
// every request.
export const ACT_AS_COOKIE = "zl_act_as";
// The OAuth state, PKCE verifier and nonce between sign-in and callback.
export const OAUTH_COOKIE = "zl_oauth";
// Go's cookies before stage 11; cleared at every sign-in and sign-out.
export const LEGACY_SESSION_COOKIES = ["zl_access", "zl_refresh"] as const;
// As long as a member's or admin's session.
export const ACT_AS_MAX_AGE = 2_592_000;

export type CookieWrite = {
  name: string;
  value: string;
  // Accepted as is by cookies().set(name, value, options) and
  // NextResponse.cookies.set(name, value, options).
  options: {
    httpOnly: true;
    sameSite: "lax";
    path: "/";
    secure: boolean;
    maxAge: number;
  };
};

export function cookieWrite(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): CookieWrite {
  return {
    name,
    value,
    options: { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge },
  };
}

function cleared(name: string, secure: boolean): CookieWrite {
  return cookieWrite(name, "", 0, secure);
}

// A new sign-in never starts out acting as someone, and Go's cookies go.
export function signedInCookieWrites(
  session: IssuedSession,
  secure: boolean,
): CookieWrite[] {
  return [
    cookieWrite(SESSION_COOKIE, session.token, session.maxAgeSeconds, secure),
    cleared(ACT_AS_COOKIE, secure),
    ...LEGACY_SESSION_COOKIES.map((name) => cleared(name, secure)),
  ];
}

// Signing out also ends acting as a member.
export function signedOutCookieWrites(secure: boolean): CookieWrite[] {
  return [SESSION_COOKIE, ACT_AS_COOKIE, ...LEGACY_SESSION_COOKIES].map(
    (name) => cleared(name, secure),
  );
}

export function actAsCookieWrite(
  ownerId: string,
  secure: boolean,
): CookieWrite {
  return cookieWrite(ACT_AS_COOKIE, ownerId, ACT_AS_MAX_AGE, secure);
}

export function clearedActAsCookieWrite(secure: boolean): CookieWrite {
  return cleared(ACT_AS_COOKIE, secure);
}
