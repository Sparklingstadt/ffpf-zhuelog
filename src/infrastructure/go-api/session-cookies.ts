import type { GoTokens } from "./client";

export const ACCESS_COOKIE = "zl_access";
export const REFRESH_COOKIE = "zl_refresh";
export const OAUTH_COOKIE = "zl_oauth";

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
    sessionCookie(REFRESH_COOKIE, tokens.refreshToken, REFRESH_MAX_AGE, secure),
  ];
}

export function clearedSessionCookies(secure = false): SessionCookie[] {
  return [ACCESS_COOKIE, REFRESH_COOKIE].map((name) =>
    sessionCookie(name, "", 0, secure),
  );
}
