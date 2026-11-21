import { NextResponse, type NextRequest } from "next/server";

import type {
  IssuedSession,
  SignInResult,
} from "@/application/identity/sign-in";
import { newSessionCookies, signIn } from "@/composition/sign-in-container";
import { clientAddress } from "@/infrastructure/auth/client-address";
import {
  ffpfRedirectUri,
  parseFfpfOAuthCookie,
} from "@/infrastructure/auth/ffpf-oauth";
import {
  isSameState,
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

export type FfpfCallbackDeps = {
  signIn: (
    input: {
      code: string;
      verifier: string;
      redirectUri: string;
      nonce: string;
    },
    client: string,
  ) => Promise<SignInResult>;
  sessionCookies: (
    previousToken: string | undefined,
    session: IssuedSession,
    secure: boolean,
  ) => Promise<CookieWrite[]>;
};

const defaultDeps: FfpfCallbackDeps = {
  signIn: (input, client) => signIn.withFfpf(input, client),
  sessionCookies: newSessionCookies,
};

// Every FFPF ID failure, and any error, shows the one callback message.
const failurePath = oauthFailurePath("error");

// GET /api/auth/callback/ffpf. The same flow as github-callback.ts: the
// state must match the zl_oauth cookie of an FFPF start before anything is
// signed in, and the ID token's nonce must be the cookie's. The code, state,
// nonce and tokens never go into a redirect URL or a log, and zl_oauth is
// cleared on every outcome.
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
          redirectUri: ffpfRedirectUri(origin),
          nonce: saved.nonce,
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
        console.warn("SIGN_IN_FFPF_REFUSED", result.reason);
      }
    } catch (error) {
      console.error("SIGN_IN_FFPF_FAILED", errorName(error));
    }
  }

  const response = NextResponse.redirect(new URL(target, origin), 303);
  for (const cookie of cookies)
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
