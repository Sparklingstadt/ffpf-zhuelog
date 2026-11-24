import { NextResponse, type NextRequest } from "next/server";

import type {
  IssuedSession,
  SignInResult,
} from "@/application/identity/sign-in";
import { newSessionCookies, signIn } from "@/composition/sign-in-container";
import { clientAddress } from "@/infrastructure/auth/client-address";
import {
  githubRedirectUri,
  isSameState,
  parseOAuthCookie,
  publicOrigin,
  requestOrigin,
} from "@/infrastructure/auth/github-oauth";
import { isSecureRequest } from "@/infrastructure/auth/secure-request";
import {
  cookieWrite,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  type CookieWrite,
} from "@/infrastructure/auth/session-cookies";
import {
  errorName,
  oauthFailurePath,
} from "@/presentation/controllers/sign-in-controller";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";

export type GitHubCallbackDeps = {
  signIn: (
    input: { code: string; verifier: string; redirectUri: string },
    client: string,
  ) => Promise<SignInResult>;
  sessionCookies: (
    previousToken: string | undefined,
    session: IssuedSession,
    secure: boolean,
  ) => Promise<CookieWrite[]>;
};

const defaultDeps: GitHubCallbackDeps = {
  signIn: (input, client) => signIn.withGitHub(input, client),
  sessionCookies: newSessionCookies,
};

// GET /api/auth/callback/github/go: the redirect URL registered with the
// GitHub OAuth App, so the path's name is fixed (changing it breaks sign-in).
// The state must match the zl_oauth cookie of a GitHub start before anything
// is signed in; the code is exchanged with the same redirect URI the
// authorize step sent. The code, state and tokens never go into a redirect
// URL or a log, and zl_oauth is cleared on every outcome.
export async function handleGitHubCallback(
  request: NextRequest,
  deps: GitHubCallbackDeps = defaultDeps,
): Promise<Response> {
  const origin = publicOrigin(requestOrigin(request.headers));
  const secure =
    isSecureRequest(request.headers) || request.nextUrl.protocol === "https:";
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const saved = parseOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value);

  let target = oauthFailurePath("error");
  const cookies: CookieWrite[] = [cookieWrite(OAUTH_COOKIE, "", 0, secure)];
  if (
    !params.has("error") &&
    saved &&
    code &&
    state &&
    isSameState(state, saved.state)
  ) {
    try {
      const result = await deps.signIn(
        {
          code,
          verifier: saved.verifier,
          redirectUri: githubRedirectUri(origin),
        },
        clientAddress(request.headers),
      );
      if (result.ok) {
        cookies.push(
          ...(await deps.sessionCookies(
            request.cookies.get(SESSION_COOKIE)?.value || undefined,
            result.session,
            secure,
          )),
        );
        target = getSafeCallbackPath(saved.callbackPath);
      } else {
        console.warn("SIGN_IN_GITHUB_REFUSED", result.reason);
        target = oauthFailurePath(result.reason);
      }
    } catch (error) {
      console.error("SIGN_IN_GITHUB_FAILED", errorName(error));
    }
  }

  const response = NextResponse.redirect(new URL(target, origin), 303);
  for (const cookie of cookies)
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
