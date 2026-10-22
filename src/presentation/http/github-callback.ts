import { NextResponse, type NextRequest } from "next/server";

import { clientAddress } from "@/infrastructure/auth/client-address";
import {
  GoApiError,
  loginGitHub,
  type GoTokens,
} from "@/infrastructure/go-api/client";
import {
  githubRedirectUri,
  isSameState,
  parseOAuthCookie,
  publicOrigin,
  requestOrigin,
} from "@/infrastructure/go-api/github-oauth";
import { isSecureRequest } from "@/infrastructure/go-api/go-api-session";
import {
  OAUTH_COOKIE,
  sessionCookie,
  sessionCookieOptions,
  type SessionCookie,
} from "@/infrastructure/go-api/session-cookies";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";

export type GitHubCallbackDeps = {
  login: (
    code: string,
    codeVerifier: string,
    redirectUri: string,
    clientIp: string,
  ) => Promise<GoTokens>;
};

const defaultDeps: GitHubCallbackDeps = {
  login: loginGitHub,
};

const failurePath = (error: "AccessDenied" | "OAuthCallbackError") =>
  `/signin?error=${error}`;

// GET /api/auth/callback/github/go. The code, state and tokens never go into
// a redirect URL or a log, and zl_oauth is cleared on every outcome.
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

  let target: string = failurePath("OAuthCallbackError");
  const cookies: SessionCookie[] = [sessionCookie(OAUTH_COOKIE, "", 0, secure)];
  if (
    !params.has("error") &&
    saved &&
    code &&
    state &&
    isSameState(state, saved.state)
  ) {
    try {
      const tokens = await deps.login(
        code,
        saved.verifier,
        githubRedirectUri(origin),
        clientAddress(request.headers),
      );
      cookies.push(...sessionCookieOptions(tokens, secure));
      target = getSafeCallbackPath(saved.callbackPath);
    } catch (error) {
      if (error instanceof GoApiError && error.status === 403)
        target = failurePath("AccessDenied");
    }
  }

  const response = NextResponse.redirect(new URL(target, origin), 303);
  for (const cookie of cookies)
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
