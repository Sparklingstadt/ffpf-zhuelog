import { RequireAdminUser } from "@/application/identity/use-cases/require-admin-user";
import { RequireViewerUser } from "@/application/identity/use-cases/require-viewer-user";
import { AuthJsCurrentUserProvider } from "@/infrastructure/auth/authjs-current-user-provider";
import { signIn, signOut } from "@/infrastructure/auth/authjs-config";

const currentUserProvider = new AuthJsCurrentUserProvider();
const requireAdminUser = new RequireAdminUser(currentUserProvider);
const requireViewerUser = new RequireViewerUser(currentUserProvider);

export function getCurrentAdminUser() {
  return requireAdminUser.execute();
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
