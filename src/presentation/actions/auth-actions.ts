"use server";

import { signInWithGitHub, signOutCurrentUser } from "@/composition/identity-container";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";

export async function signInWithGitHubAction(callbackPath: string) {
  await signInWithGitHub(getSafeCallbackPath(callbackPath));
}

export async function signOutAction() {
  await signOutCurrentUser();
}
