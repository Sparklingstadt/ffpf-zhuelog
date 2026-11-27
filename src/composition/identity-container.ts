import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { RequireAdminUser } from "@/application/identity/use-cases/require-admin-user";
import { RequireMemberUser } from "@/application/identity/use-cases/require-member-user";
import { RequireViewerUser } from "@/application/identity/use-cases/require-viewer-user";
import {
  resolveRecordOwner,
  type RecordOwner,
} from "@/application/identity/use-cases/resolve-record-owner";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import { auth } from "@/infrastructure/auth/better-auth";
import { withSessionCookieFrom } from "@/infrastructure/auth/better-auth-rules";
import { demoConfig } from "@/infrastructure/config/environment";
import { errorName } from "@/presentation/controllers/load-or";
import {
  demoFailureReason,
  demoFailureUrl,
  type DemoFailure,
} from "@/presentation/controllers/sign-in-controller";
import { getCachedCurrentUser } from "./current-user";

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

// The demo sign-in and the sign-out, for Server Actions only: they set
// cookies (Better Auth's nextCookies plugin writes them), which Server
// Components cannot do. redirect() throws NEXT_REDIRECT, so it is never
// called inside a try block. Members, Sparklingstadt ID and guests sign in
// from the browser (Better Auth's client), so Better Auth's rate limit counts
// them.

// Whether the sign-in page offers the demo account: both DEMO_LOGIN_ID and
// DEMO_PASSWORD are set.
export function demoAvailable() {
  return Promise.resolve(demoConfig() !== undefined);
}

// Signs in to the demo account with DEMO_PASSWORD on the server: anyone may
// enter the demo, so there is nothing for the rate limit to protect.
export async function signInAsDemo(redirectTo: string) {
  const demo = demoConfig();
  if (!demo) redirect(demoFailureUrl("demo-unavailable", redirectTo));
  const { loginId: username, password } = demo;
  let failure: DemoFailure | null = null;
  try {
    await auth.api.signInUsername({
      body: { username, password },
      headers: await headers(),
    });
  } catch (error) {
    failure = demoFailureReason(error);
    if (failure === "error")
      console.error("SIGN_IN_DEMO_FAILED", errorName(error));
    else console.warn("SIGN_IN_DEMO_REFUSED");
  }
  if (failure) redirect(demoFailureUrl(failure, redirectTo));
  redirect(redirectTo);
}

// Ends the Better Auth session and goes to /signin. A Sparklingstadt ID user
// goes there through the ID server's end_session_endpoint (RP-Initiated
// Logout), so the ID server's sign-in ends too; Better Auth builds that URL
// from the user's "sid" account and the provider's post-logout redirect URI.
// While an admin impersonates a member, the impersonation is stopped first
// and the admin is signed out: Better Auth would otherwise build that URL
// from the member's account and send the admin's browser to the member's
// logout.
export async function signOutCurrentUser() {
  const providerLogout = await endSession();
  redirect(providerLogout ?? "/signin");
}

// Ends the session (if any) and goes to redirectTo, without the ID server's
// logout: for a member whose password has just changed.
export async function signOutTo(redirectTo: string) {
  await endSession();
  redirect(redirectTo);
}

// Deletes the session row and the cookie; returns the ID server's logout URL
// for a Sparklingstadt ID user. Never throws: when the database cannot be
// reached the cookie is cleared anyway, and an undeleted row simply expires.
async function endSession(): Promise<string | null> {
  try {
    const { headers: sessionHeaders, providerLogout } = await sessionToEnd(
      await headers(),
    );
    const result = await auth.api.signOut({
      headers: sessionHeaders,
      body: { disableRedirect: true },
    });
    return providerLogout ? (result.url ?? null) : null;
  } catch (error) {
    console.error("SIGN_OUT_FAILED", errorName(error));
    const jar = await cookies();
    for (const { name } of jar.getAll())
      if (
        name.endsWith("better-auth.session_token") ||
        name.endsWith("better-auth.admin_session")
      )
        jar.delete(name);
    return null;
  }
}

// The request headers whose session is to be signed out: the admin's own,
// after stopping an impersonation (the session cookie Better Auth has just
// set for the admin). If the impersonation cannot be stopped, the
// impersonation session itself is signed out, without the ID server's logout
// (which would be the member's).
async function sessionToEnd(
  request: Headers,
): Promise<{ headers: Headers; providerLogout: boolean }> {
  // The raw session, not the current user: a banned member reads as signed
  // out there, but their impersonation session must still not take the
  // member's provider logout.
  const current = await auth.api.getSession({ headers: request });
  if (!current?.session.impersonatedBy)
    return { headers: request, providerLogout: true };
  try {
    const stopped = await auth.api.stopImpersonating({
      headers: request,
      returnHeaders: true,
    });
    const cookie = withSessionCookieFrom(
      request.get("cookie"),
      stopped.headers.getSetCookie(),
    );
    if (cookie) {
      const admin = new Headers(request);
      admin.set("cookie", cookie);
      return { headers: admin, providerLogout: true };
    }
  } catch (error) {
    console.error("STOP_IMPERSONATING_FAILED", errorName(error));
  }
  return { headers: request, providerLogout: false };
}

// An admin becomes the member userId (Better Auth's impersonation: the
// session's user is the member's for an hour, or until stopImpersonation).
// false when Better Auth refuses: not an admin, no such user, an admin or a
// guest as the target.
export async function impersonateMember(userId: string): Promise<boolean> {
  try {
    await auth.api.impersonateUser({
      body: { userId },
      headers: await headers(),
    });
    return true;
  } catch (error) {
    console.warn("IMPERSONATE_REFUSED", errorName(error));
    return false;
  }
}

// Ends the impersonation: the admin's own session is back. false when there
// was none to end.
export async function stopImpersonation(): Promise<boolean> {
  try {
    await auth.api.stopImpersonating({ headers: await headers() });
    return true;
  } catch (error) {
    console.warn("STOP_IMPERSONATING_REFUSED", errorName(error));
    return false;
  }
}
