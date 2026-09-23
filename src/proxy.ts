import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { contentSecurityPolicy } from "@/infrastructure/security/content-security-policy";

// Must sit alongside src/app; a root-level proxy is ignored for this layout.
export const proxy = auth((request) => {
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    request.nextUrl.protocol === "https:",
  );
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
