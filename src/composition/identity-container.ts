import { AuthenticatePasswordAccount } from "@ffpf-zhuelog/core/application/identity/use-cases/authenticate-password-account";
import { ChangeOwnPassword } from "@ffpf-zhuelog/core/application/identity/use-cases/change-own-password";
import { CreatePasswordAccount } from "@ffpf-zhuelog/core/application/identity/use-cases/create-password-account";
import { ListPasswordAccounts } from "@ffpf-zhuelog/core/application/identity/use-cases/list-password-accounts";
import { RequireAdminUser } from "@ffpf-zhuelog/core/application/identity/use-cases/require-admin-user";
import { RequireMemberUser } from "@ffpf-zhuelog/core/application/identity/use-cases/require-member-user";
import { RequireViewerUser } from "@ffpf-zhuelog/core/application/identity/use-cases/require-viewer-user";
import { ResetPasswordAccountPassword } from "@ffpf-zhuelog/core/application/identity/use-cases/reset-password-account-password";
import { AuthJsCurrentUserProvider } from "@/infrastructure/auth/authjs-current-user-provider";
import { signIn, signOut } from "@/infrastructure/auth/authjs-config";
import {
  passwordAccountRepository,
  passwordHasher,
} from "@/infrastructure/auth/password-account-services";

const currentUserProvider = new AuthJsCurrentUserProvider((id) =>
  passwordAccountRepository.findById(id),
);
const requireAdminUser = new RequireAdminUser(currentUserProvider);
const requireMemberUser = new RequireMemberUser(currentUserProvider);
const requireViewerUser = new RequireViewerUser(currentUserProvider);

export const passwordAccountUseCases = {
  authenticate: new AuthenticatePasswordAccount(
    passwordAccountRepository,
    passwordHasher,
  ),
  create: new CreatePasswordAccount(passwordAccountRepository, passwordHasher),
  reset: new ResetPasswordAccountPassword(
    passwordAccountRepository,
    passwordHasher,
  ),
  changeOwn: new ChangeOwnPassword(passwordAccountRepository, passwordHasher),
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

export async function signInWithGitHub(redirectTo: string) {
  await signIn("github", { redirectTo });
}

export async function signInAsGuest(redirectTo: string) {
  await signIn("guest", { redirectTo });
}

export async function signInWithPassword(input: {
  loginId: string;
  password: string;
  redirectTo: string;
}) {
  await signIn("password", {
    loginId: input.loginId,
    password: input.password,
    redirectTo: input.redirectTo,
  });
}

export async function signOutCurrentUser() {
  await signOut({ redirectTo: "/signin" });
}

export async function signOutTo(redirectTo: string) {
  await signOut({ redirectTo });
}
