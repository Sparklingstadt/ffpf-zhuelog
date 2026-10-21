import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { clientAddress } from "../auth/client-address";
import {
  GoApiError,
  loginGuest,
  loginPassword,
  logout,
  type GoTokens,
} from "./client";
import {
  ACCESS_COOKIE,
  clearedSessionCookies,
  REFRESH_COOKIE,
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

// Must match passwordSignInFailureUrl for CredentialsSignin, so both sign-in
// paths show the same single message. 400 (malformed input), 401 (wrong
// credentials) and 429 (too many attempts) are not told apart, and the input
// is never echoed back.
export function goPasswordFailureUrl(
  error: unknown,
  redirectTo: string,
): string | null {
  if (!(error instanceof GoApiError)) return null;
  if (![400, 401, 429].includes(error.status)) return null;
  return `/signin?error=CredentialsSignin&callbackUrl=${encodeURIComponent(redirectTo)}`;
}

export async function readAccessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value || undefined;
}

async function writeCookies(list: SessionCookie[]) {
  const store = await cookies();
  for (const cookie of list)
    store.set(cookie.name, cookie.value, cookie.options);
}

async function startSession(tokens: GoTokens) {
  const secure = isSecureRequest(await headers());
  await writeCookies(sessionCookieOptions(tokens, secure));
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
  const tokens = await loginGuest(clientAddress(await headers()));
  await startSession(tokens);
  redirect(redirectTo);
}

// Signs out locally even when the Go API cannot be reached: the cookies are
// cleared either way, and an unrevoked refresh token simply expires.
export async function signOutViaGo(redirectTo: string) {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      await logout(refreshToken);
    } catch {
      // Ignored on purpose; see above.
    }
  }
  await writeCookies(clearedSessionCookies(isSecureRequest(await headers())));
  redirect(redirectTo);
}
