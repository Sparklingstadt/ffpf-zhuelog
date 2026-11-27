"use server";

import {
  signInAsDemo,
  signOutCurrentUser,
} from "@/composition/identity-container";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";

// Members, Sparklingstadt ID and guests sign in from the browser through
// Better Auth's client (presentation/components/auth/sign-in-forms), so its
// rate limit counts them. Only the demo, which anyone may enter without a
// password, signs in on the server.
export async function signInAsDemoAction(callbackPath: string) {
  await signInAsDemo(getSafeCallbackPath(callbackPath));
}

export async function signOutAction() {
  await signOutCurrentUser();
}
