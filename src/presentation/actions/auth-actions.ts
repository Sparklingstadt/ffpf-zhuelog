"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

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

  try {
    await signInWithPassword({
      loginId: typeof loginId === "string" ? loginId : "",
      password: typeof password === "string" ? password : "",
      redirectTo: safePath,
    });
  } catch (error) {
    // Auth.js throws CredentialsSignin (an AuthError) for any failed
    // credentials. Show one generic message and never echo the input back.
    // Everything else, including redirect()'s NEXT_REDIRECT, is re-thrown.
    if (error instanceof AuthError) {
      redirect(
        `/signin?error=CredentialsSignin&callbackUrl=${encodeURIComponent(safePath)}`,
      );
    }
    throw error;
  }
}

export async function signOutAction() {
  await signOutCurrentUser();
}
