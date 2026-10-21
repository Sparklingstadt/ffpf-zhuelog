import { NextResponse, type NextRequest } from "next/server";

import { clientAddress } from "../auth/client-address";
import { GoApiError, type GoTokens } from "./client";
import {
  ACCESS_COOKIE,
  clearedSessionCookies,
  REFRESH_COOKIE,
  sessionCookieOptions,
  type SessionCookie,
} from "./session-cookies";

// The proxy for Go API sessions. It must stay free of next/headers and
// server-only modules, so it only depends on the plain Go API helpers.

export type GoProxyDeps = {
  refreshTokens: (refreshToken: string, clientIp: string) => Promise<GoTokens>;
  // Builds the pass-through response, forwarding these request headers.
  next: (request: NextRequest, requestHeaders: Headers) => NextResponse;
};

export async function goProxy(
  request: NextRequest,
  deps: GoProxyDeps,
): Promise<NextResponse> {
  const requestHeaders = new Headers(request.headers);
  // Public routes pass the gate anyway, so they never spend a refresh.
  const responseCookies = isPublicRoute(request.nextUrl.pathname)
    ? []
    : await refreshSession(request, requestHeaders, deps);
  const signedIn = Boolean(cookieValue(requestHeaders, ACCESS_COOKIE));
  const response =
    gate(request, signedIn) ?? deps.next(request, requestHeaders);
  for (const cookie of responseCookies)
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

// Gets a new token pair when only the refresh token is left. Rewrites the
// forwarded cookie header so the page sees the result, and returns the
// cookies to set on the response.
async function refreshSession(
  request: NextRequest,
  requestHeaders: Headers,
  deps: GoProxyDeps,
): Promise<SessionCookie[]> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (request.cookies.get(ACCESS_COOKIE)?.value || !refreshToken) return [];

  const secure = request.nextUrl.protocol === "https:";
  let cookies: SessionCookie[];
  try {
    const tokens = await deps.refreshTokens(
      refreshToken,
      clientAddress(request.headers),
    );
    cookies = sessionCookieOptions(tokens, secure);
  } catch (error) {
    // Only a rejected token ends the session; an unreachable API must not.
    if (!(error instanceof GoApiError) || error.status !== 401) return [];
    cookies = clearedSessionCookies(secure);
  }
  replaceSessionCookies(requestHeaders, cookies);
  return cookies;
}

// Replaces only the session cookies in the cookie header; empty values drop them.
function replaceSessionCookies(headers: Headers, cookies: SessionCookie[]) {
  const names = new Set(cookies.map((cookie) => cookie.name));
  const pairs = (headers.get("cookie") ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair && !names.has(pair.split("=")[0]!.trim()));
  for (const cookie of cookies)
    if (cookie.value) pairs.push(`${cookie.name}=${cookie.value}`);
  if (pairs.length) headers.set("cookie", pairs.join("; "));
  else headers.delete("cookie");
}

function cookieValue(headers: Headers, name: string): string | undefined {
  for (const pair of (headers.get("cookie") ?? "").split(";")) {
    const index = pair.indexOf("=");
    if (index > 0 && pair.slice(0, index).trim() === name)
      return pair.slice(index + 1).trim() || undefined;
  }
  return undefined;
}

function isPublicRoute(pathname: string): boolean {
  return pathname === "/signin" || pathname.startsWith("/api/auth/");
}

// Same rules as the Auth.js authorized callback. Only checks that a session
// cookie exists; pages confirm it with GET /v1/me. Returns null to pass.
function gate(request: NextRequest, signedIn: boolean): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  if (isPublicRoute(pathname) || signedIn) return null;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "認証が必要です。" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Server Actions perform their own authorization. Let them return the
  // typed denial; a proxy HTML redirect is not a valid action response.
  // This header is only protocol detection, never an authorization grant.
  if (request.method === "POST" && request.headers.has("next-action"))
    return null;
  const signInUrl = new URL("/signin", request.nextUrl.origin);
  signInUrl.searchParams.set(
    "callbackUrl",
    `${pathname}${request.nextUrl.search}`,
  );
  // 302, as Response.redirect gives on the Auth.js path.
  return NextResponse.redirect(signInUrl, 302);
}
