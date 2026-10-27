import { NextResponse, type NextRequest } from "next/server";
import { ffpfIdConfig } from "@/infrastructure/config/environment";
import { refreshTokens } from "@/infrastructure/go-api/client";
import { goProxy } from "@/infrastructure/go-api/go-proxy";
import { contentSecurityPolicy } from "@/infrastructure/security/content-security-policy";

// Passes the request on, adding the CSP nonce and no-store to pages.
// requestHeaders carries the cookie header as the Go session refresh left it.
function passThrough(request: NextRequest, requestHeaders: Headers) {
  if (request.nextUrl.pathname.startsWith("/api/"))
    return NextResponse.next({ request: { headers: requestHeaders } });
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // The FFPF ID sign-in form redirects to the issuer.
  const ffpf = ffpfIdConfig();
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    request.nextUrl.protocol === "https:",
    ffpf ? [new URL(ffpf.issuer).origin] : [],
  );
  const headers = new Headers(requestHeaders);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// Must sit alongside src/app; a root-level proxy is ignored for this layout.
export function proxy(request: NextRequest) {
  return goProxy(request, { refreshTokens, next: passThrough });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
