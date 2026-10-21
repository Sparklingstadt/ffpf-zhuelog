"use server";

import {
  signInAsGuest,
  signInWithGitHub,
  signInWithPassword,
  signOutCurrentUser,
} from "@/composition/identity-container";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";

export async function signInWithGitHubAction(callbackPath: string) {
  await signInWithGitHub(getSafeCallbackPath(callbackPath));
}

export async function signInAsGuestAction(callbackPath: string) {
  await signInAsGuest(getSafeCallbackPath(callbackPath));
}

export async function signInWithPasswordAction(
  callbackPath: string,
  formData: FormData,
): Promise<void> {
  const safePath = getSafeCallbackPath(callbackPath);
  const loginId = formData.get("loginId");
  const password = formData.get("password");

  // A rejected sign-in redirects to the sign-in page with one generic
  // message and never echoes the input back (goPasswordFailureUrl).
  await signInWithPassword({
    loginId: typeof loginId === "string" ? loginId : "",
    password: typeof password === "string" ? password : "",
    redirectTo: safePath,
  });
}

export async function signOutAction() {
  await signOutCurrentUser();
}
