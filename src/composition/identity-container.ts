import { cache } from "react";

import { RequireAdminUser } from "@/application/identity/use-cases/require-admin-user";
import { RequireMemberUser } from "@/application/identity/use-cases/require-member-user";
import { RequireViewerUser } from "@/application/identity/use-cases/require-viewer-user";
import {
  resolveRecordOwner,
  type RecordOwner,
} from "@/application/identity/use-cases/resolve-record-owner";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import { fetchMeOnce } from "@/infrastructure/go-api/act-as";
import { GoApiCurrentUserProvider } from "@/infrastructure/go-api/go-api-current-user-provider";
import {
  readAccessToken,
  readActAsCookie,
  signInAsGuestViaGo,
  signInWithFfpfViaGo,
  signInWithGitHubViaGo,
  signInWithPasswordViaGo,
  signOutViaGo,
  startActingAsViaGo,
  stopActingViaGo,
} from "@/infrastructure/go-api/go-api-session";
import { createAccountGateway } from "@/infrastructure/go-api/account-gateway";

const goApiUserProvider = new GoApiCurrentUserProvider(
  readAccessToken,
  fetchMeOnce,
  readActAsCookie,
);
// One GET /v1/me per request, however many guards and pages ask.
const getGoApiUser = cache(() => goApiUserProvider.getCurrentUser());
const currentUserProvider: CurrentUserProvider = {
  getCurrentUser: getGoApiUser,
};
const requireAdminUser = new RequireAdminUser(currentUserProvider);
const requireMemberUser = new RequireMemberUser(currentUserProvider);
const requireViewerUser = new RequireViewerUser(currentUserProvider);

// Password accounts (admin) and a member's own password go through the Go
// API as the signed-in user.
export const memberAccounts = createAccountGateway();

export function getCurrentAdminUser() {
  return requireAdminUser.execute();
}

export function getCurrentMemberUser() {
  return requireMemberUser.execute();
}

export function getCurrentViewerUser() {
  return requireViewerUser.execute();
}

// Reads the user through the same provider as the other getters so a revoked
// session (sessionVersion) is denied here too. The user comes back with the
// owner so pages need not read the session twice.
export async function getRecordOwner(requested: string | undefined): Promise<{
  user: AuthenticatedUser | null;
  owner: RecordOwner;
}> {
  const user = await getCurrentViewerUser();
  return { user, owner: resolveRecordOwner(user, requested) };
}

export async function signInWithGitHub(redirectTo: string) {
  await signInWithGitHubViaGo(redirectTo);
}

export async function signInWithFfpf(redirectTo: string) {
  await signInWithFfpfViaGo(redirectTo);
}

export async function signInAsGuest(redirectTo: string) {
  await signInAsGuestViaGo(redirectTo);
}

export async function signInWithPassword(input: {
  loginId: string;
  password: string;
  redirectTo: string;
}) {
  await signInWithPasswordViaGo(input);
}

export async function signOutCurrentUser() {
  await signOutTo("/signin");
}

export async function signOutTo(redirectTo: string) {
  await signOutViaGo(redirectTo);
}

// An admin acting as a member: their records become the member's while the
// admin keeps the admin role. Returns whether Go confirmed the member.
export function startActingAs(ownerId: string) {
  return startActingAsViaGo(ownerId);
}

export function stopActing() {
  return stopActingViaGo();
}
