import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type {
  IssuedSession,
  SignInResult,
} from "@/application/identity/sign-in";
import { RequireAdminUser } from "@/application/identity/use-cases/require-admin-user";
import { RequireMemberUser } from "@/application/identity/use-cases/require-member-user";
import { RequireViewerUser } from "@/application/identity/use-cases/require-viewer-user";
import {
  resolveRecordOwner,
  type RecordOwner,
} from "@/application/identity/use-cases/resolve-record-owner";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import { clientAddress } from "@/infrastructure/auth/client-address";
import { resolveSignOutTarget } from "@/infrastructure/auth/sid-logout";
import {
  createSidOAuthStart,
  sidAuthorizeUrl,
  sidRedirectUri,
} from "@/infrastructure/auth/sid-oauth";
import {
  createOAuthStart,
  githubAuthorizeUrl,
  githubRedirectUri,
  OAUTH_COOKIE_MAX_AGE,
  publicOrigin,
  requestOrigin,
} from "@/infrastructure/auth/github-oauth";
import { isSecureRequest } from "@/infrastructure/auth/secure-request";
import {
  clearedActAsCookieWrite,
  cookieWrite,
  OAUTH_COOKIE,
  signedOutCookieWrites,
} from "@/infrastructure/auth/session-cookies";
import {
  readSessionToken,
  requestIsSecure,
  writeCookies,
} from "@/infrastructure/auth/web-session";
import {
  demoLoginId,
  sidConfig,
  githubOAuthConfig,
} from "@/infrastructure/config/environment";
import {
  demoFailureUrl,
  errorName,
  guestFailureUrl,
  passwordFailureUrl,
} from "@/presentation/controllers/sign-in-controller";
import { getCachedCurrentUser } from "./current-user";
import { newSessionCookies, sessionStore, signIn } from "./sign-in-container";

// Decided from the Better Auth session, once per request.
const currentUserProvider: CurrentUserProvider = {
  getCurrentUser: getCachedCurrentUser,
};
const requireAdminUser = new RequireAdminUser(currentUserProvider);
const requireMemberUser = new RequireMemberUser(currentUserProvider);
const requireViewerUser = new RequireViewerUser(currentUserProvider);

export function getCurrentAdminUser() {
  return requireAdminUser.execute();
}

export function getCurrentMemberUser() {
  return requireMemberUser.execute();
}

export function getCurrentViewerUser() {
  return requireViewerUser.execute();
}

// Reads the user through the same provider as the other getters so an
// ended session or a banned user is denied here too. The user comes back with the
// owner so pages need not read the session twice.
export async function getRecordOwner(requested: string | undefined): Promise<{
  user: AuthenticatedUser | null;
  owner: RecordOwner;
}> {
  const user = await getCurrentViewerUser();
  return { user, owner: resolveRecordOwner(user, requested) };
}

// Sign-in and sign-out, for Server Actions only: they set cookies, which
// Server Components cannot do. Next.js accepts Server Actions by POST only
// and checks their Origin against the Host; the cookies are SameSite=Lax.
// redirect() throws NEXT_REDIRECT, so it is never called inside a try block.

// Every sign-in gets a new token: the browser's previous Session row is
// ended, and zl_act_as and the cookies an earlier version of this app set
// are cleared with it.
async function startSession(session: IssuedSession) {
  await writeCookies(
    await newSessionCookies(
      await readSessionToken(),
      session,
      await requestIsSecure(),
    ),
  );
}

// Store and hasher errors are thrown (the sign-in page's error boundary);
// every refusal is the one credential message.
export async function signInWithPassword(input: {
  loginId: string;
  password: string;
  redirectTo: string;
}) {
  const client = clientAddress(await headers());
  const result = await signIn.withPassword(
    { loginId: input.loginId, password: input.password },
    client,
  );
  if (!result.ok) redirect(passwordFailureUrl(result.reason, input.redirectTo));
  await startSession(result.session);
  redirect(input.redirectTo);
}

export async function signInAsGuest(redirectTo: string) {
  const client = clientAddress(await headers());
  let result: SignInResult;
  try {
    result = await signIn.asGuest(client);
  } catch (error) {
    console.error("SIGN_IN_GUEST_FAILED", errorName(error));
    redirect(guestFailureUrl(redirectTo));
  }
  if (!result.ok) {
    console.warn("SIGN_IN_GUEST_REFUSED", result.reason);
    redirect(guestFailureUrl(redirectTo));
  }
  await startSession(result.session);
  redirect(redirectTo);
}

export async function signInAsDemo(redirectTo: string) {
  const client = clientAddress(await headers());
  let result: SignInResult;
  try {
    result = await signIn.asDemo(client);
  } catch (error) {
    console.error("SIGN_IN_DEMO_FAILED", errorName(error));
    redirect(demoFailureUrl("error", redirectTo));
  }
  if (!result.ok) {
    console.warn("SIGN_IN_DEMO_REFUSED", result.reason);
    redirect(demoFailureUrl(result.reason, redirectTo));
  }
  await startSession(result.session);
  redirect(redirectTo);
}

// Starts GitHub sign-in: PKCE and state go into zl_oauth (SameSite=Lax, so
// it comes back with GitHub's top-level redirect), and the browser goes to
// GitHub. /api/auth/callback/github/go finishes it with the same redirect
// URI (requestOrigin -> publicOrigin, so AUTH_URL when set).
export async function signInWithGitHub(redirectTo: string) {
  const config = githubOAuthConfig();
  if (!config) redirect("/signin?error=Configuration");
  const requestHeaders = await headers();
  const start = createOAuthStart(redirectTo);
  await writeCookies([
    cookieWrite(
      OAUTH_COOKIE,
      start.cookieValue,
      OAUTH_COOKIE_MAX_AGE,
      isSecureRequest(requestHeaders),
    ),
  ]);
  redirect(
    githubAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: githubRedirectUri(
        publicOrigin(requestOrigin(requestHeaders)),
      ),
      state: start.state,
      challenge: start.challenge,
    }),
  );
}

// Starts Sparklingstadt ID sign-in the same way: PKCE, state and nonce go into
// zl_oauth (provider "sid"), and the browser goes to the Sparklingstadt ID server's authorize
// endpoint. /api/auth/callback/sid finishes it.
export async function signInWithSid(redirectTo: string) {
  const config = sidConfig();
  if (!config) redirect("/signin?error=Configuration");
  const requestHeaders = await headers();
  const start = createSidOAuthStart(redirectTo);
  await writeCookies([
    cookieWrite(
      OAUTH_COOKIE,
      start.cookieValue,
      OAUTH_COOKIE_MAX_AGE,
      isSecureRequest(requestHeaders),
    ),
  ]);
  redirect(
    sidAuthorizeUrl({
      issuer: config.issuer,
      clientId: config.clientId,
      redirectUri: sidRedirectUri(publicOrigin(requestOrigin(requestHeaders))),
      state: start.state,
      challenge: start.challenge,
      nonce: start.nonce,
    }),
  );
}

// Whether the sign-in page offers the demo account: whether DEMO_LOGIN_ID is
// set.
export function demoAvailable() {
  return Promise.resolve(Boolean(demoLoginId()));
}

// A Sparklingstadt ID member also leaves the ID server (RP-Initiated Logout),
// which returns to /signin. The user is read before the session is ended, and
// an admin impersonating a member is judged by the admin's own id, so an
// admin is never sent there. (Better Auth user ids never carry "sid:", so
// until Task 6's sign-out this always answers /signin.) The origin is the sign-in callback's (publicOrigin).
export async function signOutCurrentUser() {
  const target = await resolveSignOutTarget({
    currentOwnerId: async () => {
      const user = await getCachedCurrentUser();
      return user?.impersonatedBy ?? user?.userId ?? null;
    },
    config: () => sidConfig() ?? null,
    origin: async () => publicOrigin(requestOrigin(await headers())),
    onError: (error) =>
      console.error("SID_LOGOUT_URL_FAILED", errorName(error)),
  });
  await signOutTo(target);
}

// Signs out even when the database cannot be reached: the cookies are
// cleared either way, and an undeleted row simply expires.
export async function signOutTo(redirectTo: string) {
  const token = await readSessionToken();
  if (token) {
    try {
      await sessionStore.end(token);
    } catch (error) {
      console.error("SESSION_END_FAILED", errorName(error));
    }
  }
  await writeCookies(signedOutCookieWrites(await requestIsSecure()));
  redirect(redirectTo);
}

// Clears the retired zl_act_as cookie (nothing reads it any more). Task 7 of
// the Better Auth migration replaces this with ending the impersonation.
export async function stopActing() {
  await writeCookies([clearedActAsCookieWrite(await requestIsSecure())]);
}
