import { getSessionCookie } from "better-auth/cookies";

// Whether the request carries a Better Auth session cookie
// (better-auth.session_token, or its __Secure- form over HTTPS). Only that
// it is there: the cookie is neither verified nor looked up, so this is safe
// for the proxy, and the pages check the session itself.
export function hasSessionCookie(request: Request): boolean {
  return Boolean(getSessionCookie(request));
}
