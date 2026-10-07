import { RequireAdminUser } from "@ffpf-zhuelog/core/application/identity/use-cases/require-admin-user";
import { RequireMemberUser } from "@ffpf-zhuelog/core/application/identity/use-cases/require-member-user";
import { RequireViewerUser } from "@ffpf-zhuelog/core/application/identity/use-cases/require-viewer-user";
import { AuthJsCurrentUserProvider } from "@/infrastructure/auth/authjs-current-user-provider";
import { signIn, signOut } from "@/infrastructure/auth/authjs-config";

const currentUserProvider = new AuthJsCurrentUserProvider();
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

export async function signInWithGitHub(redirectTo: string) {
  await signIn("github", { redirectTo });
}

export async function signInAsGuest(redirectTo: string) {
  await signIn("guest", { redirectTo });
}

export async function signOutCurrentUser() {
  await signOut({ redirectTo: "/signin" });
}
