import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isGoAuthEnabled } from "@/infrastructure/config/environment";
import { refreshTokens } from "@/infrastructure/go-api/client";
import { goProxy } from "@/infrastructure/go-api/go-proxy";
import { contentSecurityPolicy } from "@/infrastructure/security/content-security-policy";

// Passes the request on, adding the CSP nonce and no-store to pages. Shared by
// both auth modes; requestHeaders carries a rewritten cookie header in Go mode.
function passThrough(request: NextRequest, requestHeaders?: Headers) {
  if (request.nextUrl.pathname.startsWith("/api/"))
    return requestHeaders
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : NextResponse.next();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    request.nextUrl.protocol === "https:",
  );
  const headers = new Headers(requestHeaders ?? request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

const authJsProxy = auth((request) => passThrough(request));

// Must sit alongside src/app; a root-level proxy is ignored for this layout.
// Next passes (request, event); Auth.js hands the second argument on unused.
export function proxy(...args: Parameters<typeof authJsProxy>) {
  if (isGoAuthEnabled())
    return goProxy(args[0], { refreshTokens, next: passThrough });
  return authJsProxy(...args);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
