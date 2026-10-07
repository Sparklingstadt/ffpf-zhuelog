"use server";

import { redirect } from "next/navigation";

import {
  signInAsGuest,
  signInWithGitHub,
  signInWithPassword,
  signOutCurrentUser,
} from "@/composition/identity-container";
import { passwordSignInFailureUrl } from "@/presentation/http/password-sign-in-failure";
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

  try {
    await signInWithPassword({
      loginId: typeof loginId === "string" ? loginId : "",
      password: typeof password === "string" ? password : "",
      redirectTo: safePath,
    });
  } catch (error) {
    // Auth.js throws CredentialsSignin only when authorize rejects the
    // credentials. Show one generic message and never echo the input back.
    // Anything else (other AuthErrors such as a DB outage, and redirect()'s
    // NEXT_REDIRECT) is re-thrown.
    const failureUrl = passwordSignInFailureUrl(error, safePath);
    if (failureUrl) redirect(failureUrl);
    throw error;
  }
}

export async function signOutAction() {
  await signOutCurrentUser();
}
