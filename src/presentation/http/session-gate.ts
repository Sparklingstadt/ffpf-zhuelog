import { NextResponse, type NextRequest } from "next/server";

import { hasSessionCookie } from "@/infrastructure/auth/session-cookie";

// The proxy's gate: passes public routes and any request carrying a Better
// Auth session cookie; it never reads the database (the pages check the
// session itself through getCachedCurrentUser). It never writes cookies
// either, and forwards the request untouched. It imports no next/headers and
// nothing that reads the database or the Better Auth server: only the cookie
// reader of better-auth/cookies (through infrastructure/auth/session-cookie).
export function sessionGate(
  request: NextRequest,
  next: (request: NextRequest) => NextResponse,
): NextResponse {
  const pathname = request.nextUrl.pathname;
  if (isPublicRoute(pathname) || hasSessionCookie(request))
    return next(request);
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
    return next(request);
  const signInUrl = new URL("/signin", request.nextUrl.origin);
  signInUrl.searchParams.set(
    "callbackUrl",
    `${pathname}${request.nextUrl.search}`,
  );
  // 302, as Response.redirect gives.
  return NextResponse.redirect(signInUrl, 302);
}

// The LINE webhook and the cron routes carry no session cookie: they check
// their own credential (the LINE signature, the cron secret). Every route
// under /api/cron/ is public here, so each one must check the bearer secret
// itself through handleCronRequest.
export function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/signin" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/line/webhook" ||
    pathname.startsWith("/api/cron/") ||
    isMetadataFile(pathname)
  );
}

// The files Next.js serves for crawlers and link previews (the metadata
// file conventions in src/app). They are public and are not pages, so they
// get neither the sign-in gate nor the page-only CSP and no-store headers.
export function isMetadataFile(pathname: string): boolean {
  return (
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /^\/(opengraph|twitter)-image(\.[a-z]+)?$/.test(pathname)
  );
}
