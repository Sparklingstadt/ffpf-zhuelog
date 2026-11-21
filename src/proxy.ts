import { NextResponse, type NextRequest } from "next/server";
import { ffpfIdConfig } from "@/infrastructure/config/environment";
import { contentSecurityPolicy } from "@/infrastructure/security/content-security-policy";
import { isMetadataFile, sessionGate } from "@/presentation/http/session-gate";

// Passes the request on as the browser sent it, adding only the CSP nonce
// (overwriting any x-nonce the browser sent) and no-store to pages.
function passThrough(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/") || isMetadataFile(pathname))
    return NextResponse.next();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // The FFPF ID sign-in form redirects to the issuer.
  const ffpf = ffpfIdConfig();
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    request.nextUrl.protocol === "https:",
    ffpf ? [new URL(ffpf.issuer).origin] : [],
  );
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// Must sit alongside src/app; a root-level proxy is ignored for this layout.
// Only checks that zl_session exists; pages, actions and route handlers check
// the session itself (getCachedCurrentUser).
export function proxy(request: NextRequest) {
  return sessionGate(request, passThrough);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
