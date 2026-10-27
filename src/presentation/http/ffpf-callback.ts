import { NextResponse, type NextRequest } from "next/server";

import { clientAddress } from "@/infrastructure/auth/client-address";
import { loginFFPF, type GoTokens } from "@/infrastructure/go-api/client";
import {
  ffpfRedirectUri,
  parseFfpfOAuthCookie,
} from "@/infrastructure/go-api/ffpf-oauth";
import {
  isSameState,
  publicOrigin,
  requestOrigin,
} from "@/infrastructure/go-api/github-oauth";
import { isSecureRequest } from "@/infrastructure/go-api/go-api-session";
import {
  OAUTH_COOKIE,
  sessionCookie,
  clearedActAsCookie,
  sessionCookieOptions,
  type SessionCookie,
} from "@/infrastructure/go-api/session-cookies";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";

export type FfpfCallbackDeps = {
  login: (
    code: string,
    codeVerifier: string,
    redirectUri: string,
    nonce: string,
    clientIp: string,
  ) => Promise<GoTokens>;
};

const defaultDeps: FfpfCallbackDeps = {
  login: loginFFPF,
};

const failurePath = "/signin?error=OAuthCallbackError";

// GET /api/auth/callback/ffpf. The same flow as github-callback.ts: the
// state must match the zl_oauth cookie of an FFPF start before Go is asked,
// and Go checks the ID token's nonce against the cookie's. The code, state
// and tokens never go into a redirect URL or a log, and zl_oauth is cleared
// on every outcome. Every failure is OAuthCallbackError.
export async function handleFfpfCallback(
  request: NextRequest,
  deps: FfpfCallbackDeps = defaultDeps,
): Promise<Response> {
  const origin = publicOrigin(requestOrigin(request.headers));
  const secure =
    isSecureRequest(request.headers) || request.nextUrl.protocol === "https:";
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const saved = parseFfpfOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value);

  let target = failurePath;
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
        ffpfRedirectUri(origin),
        saved.nonce,
        clientAddress(request.headers),
      );
      cookies.push(
        ...sessionCookieOptions(tokens, secure),
        clearedActAsCookie(secure),
      );
      target = getSafeCallbackPath(saved.callbackPath);
    } catch {
      // 401 (bad code or token), 502 (portal unreachable), 503 (disabled)
      // and network errors all show the same message.
    }
  }

  const response = NextResponse.redirect(new URL(target, origin), 303);
  for (const cookie of cookies)
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
