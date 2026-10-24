import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { clientAddress } from "../auth/client-address";
import {
  fetchMe,
  GoApiError,
  loginGuest,
  loginPassword,
  logout,
  type GoTokens,
} from "./client";
import {
  createOAuthStart,
  githubAuthorizeUrl,
  githubRedirectUri,
  OAUTH_COOKIE_MAX_AGE,
  publicOrigin,
  requestOrigin,
} from "./github-oauth";
import {
  ACCESS_COOKIE,
  ACT_AS_COOKIE,
  actAsCookie,
  clearedActAsCookie,
  clearedSessionCookies,
  OAUTH_COOKIE,
  REFRESH_COOKIE,
  sessionCookie,
  sessionCookieOptions,
  type SessionCookie,
} from "./session-cookies";

// Sign-in and sign-out through the Go API, for Server Actions only: they set
// cookies, which Server Components cannot do. redirect() throws NEXT_REDIRECT,
// so it is never called inside a try block.

// HTTPS behind Vercel's proxy shows up as x-forwarded-proto; AUTH_URL covers
// deployments that state their public origin.
export function isSecureRequest(requestHeaders: Headers): boolean {
  const proto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (
    proto === "https" || Boolean(process.env.AUTH_URL?.startsWith("https:"))
  );
}

// One message for every rejected password sign-in: 400 (malformed input),
// 401 (wrong credentials) and 429 (too many attempts) are not told apart, and
// the input is never echoed back. The sign-in page shows it for the
// CredentialsSignin key.
export function goPasswordFailureUrl(
  error: unknown,
  redirectTo: string,
): string | null {
  if (!(error instanceof GoApiError)) return null;
  if (![400, 401, 429].includes(error.status)) return null;
  return `/signin?error=CredentialsSignin&callbackUrl=${encodeURIComponent(redirectTo)}`;
}

// Any failure of the guest login (429, 503, unreachable) shows the sign-in
// page's generic message: "Unknown" is not an errorMessages key on purpose.
export function goGuestFailureUrl(
  error: unknown,
  redirectTo: string,
): string | null {
  if (!(error instanceof GoApiError)) return null;
  return `/signin?error=Unknown&callbackUrl=${encodeURIComponent(redirectTo)}`;
}

export async function readAccessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value || undefined;
}

export async function readActAsCookie(): Promise<string | undefined> {
  return (await cookies()).get(ACT_AS_COOKIE)?.value || undefined;
}

async function writeCookies(list: SessionCookie[]) {
  const store = await cookies();
  for (const cookie of list)
    store.set(cookie.name, cookie.value, cookie.options);
}

async function startSession(tokens: GoTokens) {
  const secure = isSecureRequest(await headers());
  await writeCookies([
    ...sessionCookieOptions(tokens, secure),
    clearedActAsCookie(secure),
  ]);
}

// Starts acting as the member ownerId. The cookie is written only when Go
// confirms it (actingAs), so an older API that ignores the header never makes
// the admin's own records look like the member's. Returns whether it started;
// a Go failure other than refusing the member is thrown.
export async function startActingAsViaGo(ownerId: string): Promise<boolean> {
  const accessToken = await readAccessToken();
  if (!accessToken) return false;
  let actingAs: string | undefined;
  try {
    const me = await fetchMe(accessToken, ownerId);
    if (me.role === "admin") actingAs = me.actingAs?.ownerId;
  } catch (error) {
    if (error instanceof GoApiError && [400, 403, 404].includes(error.status))
      return false;
    throw error;
  }
  if (actingAs !== ownerId) return false;
  await writeCookies([actAsCookie(ownerId, isSecureRequest(await headers()))]);
  return true;
}

export async function stopActingViaGo() {
  await writeCookies([clearedActAsCookie(isSecureRequest(await headers()))]);
}

export async function signInWithPasswordViaGo(input: {
  loginId: string;
  password: string;
  redirectTo: string;
}) {
  const clientIp = clientAddress(await headers());
  let tokens: GoTokens;
  try {
    tokens = await loginPassword(input.loginId, input.password, clientIp);
  } catch (error) {
    const failureUrl = goPasswordFailureUrl(error, input.redirectTo);
    if (!failureUrl) throw error;
    redirect(failureUrl);
  }
  await startSession(tokens);
  redirect(input.redirectTo);
}

export async function signInAsGuestViaGo(redirectTo: string) {
  const clientIp = clientAddress(await headers());
  let tokens: GoTokens;
  try {
    tokens = await loginGuest(clientIp);
  } catch (error) {
    const failureUrl = goGuestFailureUrl(error, redirectTo);
    if (!failureUrl) throw error;
    redirect(failureUrl);
  }
  await startSession(tokens);
  redirect(redirectTo);
}

// Starts GitHub sign-in: PKCE and state go into zl_oauth (SameSite=Lax, so
// it comes back with GitHub's top-level redirect), and the browser goes to
// GitHub. /api/auth/callback/github/go finishes it.
export async function signInWithGitHubViaGo(redirectTo: string) {
  const clientId = process.env.AUTH_GITHUB_ID;
  if (!clientId) redirect("/signin?error=Configuration");
  const requestHeaders = await headers();
  const start = createOAuthStart(redirectTo);
  await writeCookies([
    sessionCookie(
      OAUTH_COOKIE,
      start.cookieValue,
      OAUTH_COOKIE_MAX_AGE,
      isSecureRequest(requestHeaders),
    ),
  ]);
  redirect(
    githubAuthorizeUrl({
      clientId,
      redirectUri: githubRedirectUri(
        publicOrigin(requestOrigin(requestHeaders)),
      ),
      state: start.state,
      challenge: start.challenge,
    }),
  );
}

// Signs out locally even when the Go API cannot be reached: the cookies are
// cleared either way, and an unrevoked refresh token simply expires.
export async function signOutViaGo(redirectTo: string) {
  const requestHeaders = await headers();
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      await logout(refreshToken, clientAddress(requestHeaders));
    } catch {
      // Ignored on purpose; see above.
    }
  }
  await writeCookies(clearedSessionCookies(isSecureRequest(requestHeaders)));
  redirect(redirectTo);
}
