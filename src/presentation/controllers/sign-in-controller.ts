import type { SignInFailure } from "@/application/identity/sign-in";

// Where a failed sign-in goes, with the sign-in page's error keys (the same
// URLs as when Go signed in). The input is never echoed back, and nothing
// but the key and the page to come back to goes into the URL.

function signInUrl(error: string, redirectTo: string): string {
  return `/signin?error=${error}&callbackUrl=${encodeURIComponent(redirectTo)}`;
}

// One message for every rejected password sign-in: wrong credentials of any
// kind and too many attempts are not told apart. Store and hasher errors are
// thrown before this (the sign-in page's error boundary).
export function passwordFailureUrl(
  _reason: SignInFailure,
  redirectTo: string,
): string {
  return signInUrl("CredentialsSignin", redirectTo);
}

// Any failure of the guest sign-in shows the sign-in page's generic message:
// "Unknown" is not an errorMessages key on purpose.
export function guestFailureUrl(redirectTo: string): string {
  return signInUrl("Unknown", redirectTo);
}

// The demo says when it is off or not set up yet; anything else is the
// generic message, as for guests.
export function demoFailureUrl(
  reason: SignInFailure | "error",
  redirectTo: string,
): string {
  return signInUrl(
    reason === "demo-unavailable" ? "DemoUnavailable" : "Unknown",
    redirectTo,
  );
}

// Only a GitHub user off the allowlist is told so; every other OAuth failure,
// and any error, is the one callback message.
export function oauthFailurePath(reason: SignInFailure | "error"): string {
  return reason === "forbidden"
    ? "/signin?error=AccessDenied"
    : "/signin?error=OAuthCallbackError";
}

// What a sign-in log may say about an error: its name, never its message.
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
