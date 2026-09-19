import { RequireAdminUser } from "@/application/identity/use-cases/require-admin-user";
import { AuthJsCurrentUserProvider } from "@/infrastructure/auth/authjs-current-user-provider";
import { signIn, signOut } from "@/infrastructure/auth/authjs-config";

const requireAdminUser = new RequireAdminUser(new AuthJsCurrentUserProvider());

export function getCurrentAdminUser() {
  return requireAdminUser.execute();
}

export async function signInWithGitHub(redirectTo: string) {
  await signIn("github", { redirectTo });
}

export async function signOutCurrentUser() {
  await signOut({ redirectTo: "/signin" });
}
