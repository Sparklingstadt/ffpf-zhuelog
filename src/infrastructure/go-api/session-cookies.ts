import type { GoTokens } from "./client";

export const ACCESS_COOKIE = "zl_access";
export const REFRESH_COOKIE = "zl_refresh";
export const OAUTH_COOKIE = "zl_oauth";
// The member ownerId an admin acts as; see act-as.ts.
export const ACT_AS_COOKIE = "zl_act_as";

// Used when the Go API does not say how long the refresh token lives.
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;
// Expire the access cookie a minute before the token itself does.
const ACCESS_MARGIN = 60;

export type SessionCookie = {
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

export function sessionCookie(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): SessionCookie {
  return {
    name,
    value,
    options: { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge },
  };
}

export function sessionCookieOptions(
  tokens: GoTokens,
  secure: boolean,
): SessionCookie[] {
  return [
    sessionCookie(
      ACCESS_COOKIE,
      tokens.accessToken,
      Math.max(0, tokens.expiresIn - ACCESS_MARGIN),
      secure,
    ),
    sessionCookie(
      REFRESH_COOKIE,
      tokens.refreshToken,
      refreshMaxAge(tokens.refreshExpiresIn),
      secure,
    ),
  ];
}

function refreshMaxAge(refreshExpiresIn: number | undefined): number {
  return typeof refreshExpiresIn === "number" &&
    Number.isFinite(refreshExpiresIn) &&
    refreshExpiresIn > 0
    ? Math.floor(refreshExpiresIn)
    : REFRESH_MAX_AGE;
}

// Signing out, or losing the session, also ends acting as a member.
export function clearedSessionCookies(secure = false): SessionCookie[] {
  return [ACCESS_COOKIE, REFRESH_COOKIE, ACT_AS_COOKIE].map((name) =>
    sessionCookie(name, "", 0, secure),
  );
}

// Lives as long as an admin's refresh token.
export function actAsCookie(ownerId: string, secure: boolean): SessionCookie {
  return sessionCookie(ACT_AS_COOKIE, ownerId, REFRESH_MAX_AGE, secure);
}

// A new sign-in never starts out acting as someone.
export function clearedActAsCookie(secure: boolean): SessionCookie {
  return sessionCookie(ACT_AS_COOKIE, "", 0, secure);
}
