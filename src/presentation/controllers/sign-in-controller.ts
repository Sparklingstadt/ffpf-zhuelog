// Where a failed demo sign-in goes, with the sign-in page's error keys. The
// other sign-ins run in the browser and show their messages there
// (presentation/components/auth/sign-in-forms).

export type DemoFailure = "demo-unavailable" | "error";

// A refusal (Better Auth's 4xx: the demo account or its password is not
// there yet) means the demo is not set up; anything else is an error.
export function demoFailureReason(error: unknown): DemoFailure {
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode: unknown }).statusCode
      : undefined;
  return typeof status === "number" && status >= 400 && status < 500
    ? "demo-unavailable"
    : "error";
}

// The demo says when it is off or not set up; anything else is the generic
// message ("Unknown" is not an errorMessages key on purpose). Nothing but the
// key and the page to come back to goes into the URL.
export function demoFailureUrl(
  reason: DemoFailure,
  redirectTo: string,
): string {
  const error = reason === "demo-unavailable" ? "DemoUnavailable" : "Unknown";
  return `/signin?error=${error}&callbackUrl=${encodeURIComponent(redirectTo)}`;
}
