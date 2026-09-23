"use server";

import {
  signInAsGuest,
  signInWithGitHub,
  signOutCurrentUser,
} from "@/composition/identity-container";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";

export async function signInWithGitHubAction(callbackPath: string) {
  await signInWithGitHub(getSafeCallbackPath(callbackPath));
}

export async function signInAsGuestAction(callbackPath: string) {
  await signInAsGuest(getSafeCallbackPath(callbackPath));
}

export async function signOutAction() {
  await signOutCurrentUser();
}
