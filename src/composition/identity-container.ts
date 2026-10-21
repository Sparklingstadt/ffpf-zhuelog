import { cache } from "react";

import { ChangeOwnPassword } from "@/application/identity/use-cases/change-own-password";
import { CreatePasswordAccount } from "@/application/identity/use-cases/create-password-account";
import { ListPasswordAccounts } from "@/application/identity/use-cases/list-password-accounts";
import { RequireAdminUser } from "@/application/identity/use-cases/require-admin-user";
import { RequireMemberUser } from "@/application/identity/use-cases/require-member-user";
import { RequireViewerUser } from "@/application/identity/use-cases/require-viewer-user";
import {
  resolveRecordOwner,
  type RecordOwner,
} from "@/application/identity/use-cases/resolve-record-owner";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { ResetPasswordAccountPassword } from "@/application/identity/use-cases/reset-password-account-password";
import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import { AuthJsCurrentUserProvider } from "@/infrastructure/auth/authjs-current-user-provider";
import { signIn, signOut } from "@/infrastructure/auth/authjs-config";
import { isGoAuthEnabled } from "@/infrastructure/config/environment";
import { fetchMe } from "@/infrastructure/go-api/client";
import { GoApiCurrentUserProvider } from "@/infrastructure/go-api/go-api-current-user-provider";
import {
  readAccessToken,
  signInAsGuestViaGo,
  signInWithPasswordViaGo,
  signOutViaGo,
} from "@/infrastructure/go-api/go-api-session";
import {
  passwordAccountRepository,
  passwordHasher,
  signInThrottle,
} from "@/infrastructure/auth/password-account-services";

const authJsUserProvider = new AuthJsCurrentUserProvider((id) =>
  passwordAccountRepository.findById(id),
);
const goApiUserProvider = new GoApiCurrentUserProvider(
  readAccessToken,
  fetchMe,
);
// One GET /v1/me per request, however many guards and pages ask.
const getGoApiUser = cache(() => goApiUserProvider.getCurrentUser());
// GO_API_URL switches sign-in to the Go API; without it Auth.js stays as is.
const currentUserProvider: CurrentUserProvider = {
  getCurrentUser: () =>
    isGoAuthEnabled() ? getGoApiUser() : authJsUserProvider.getCurrentUser(),
};
const requireAdminUser = new RequireAdminUser(currentUserProvider);
const requireMemberUser = new RequireMemberUser(currentUserProvider);
const requireViewerUser = new RequireViewerUser(currentUserProvider);

export const passwordAccountUseCases = {
  create: new CreatePasswordAccount(passwordAccountRepository, passwordHasher),
  reset: new ResetPasswordAccountPassword(
    passwordAccountRepository,
    passwordHasher,
  ),
  changeOwn: new ChangeOwnPassword(
    passwordAccountRepository,
    passwordHasher,
    signInThrottle,
  ),
  list: new ListPasswordAccounts(passwordAccountRepository),
};

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

// Stays on Auth.js even with GO_API_URL until the Go GitHub sign-in (PKCE
// and /api/auth/callback/github/go) replaces it here.
export async function signInWithGitHub(redirectTo: string) {
  await signIn("github", { redirectTo });
}

export async function signInAsGuest(redirectTo: string) {
  if (isGoAuthEnabled()) return signInAsGuestViaGo(redirectTo);
  await signIn("guest", { redirectTo });
}

export async function signInWithPassword(input: {
  loginId: string;
  password: string;
  redirectTo: string;
}) {
  if (isGoAuthEnabled()) return signInWithPasswordViaGo(input);
  await signIn("password", {
    loginId: input.loginId,
    password: input.password,
    redirectTo: input.redirectTo,
  });
}

export async function signOutCurrentUser() {
  await signOutTo("/signin");
}

export async function signOutTo(redirectTo: string) {
  if (isGoAuthEnabled()) return signOutViaGo(redirectTo);
  await signOut({ redirectTo });
}
