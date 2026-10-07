import { AuthError, CredentialsSignin } from "next-auth";

// Only a rejected credential (authorize returned null) is a login failure.
// Infrastructure errors such as CallbackRouteError (e.g. a DB outage) must not
// be presented as wrong credentials, so they yield null and are re-thrown.
export function passwordSignInFailureUrl(
  error: unknown,
  safePath: string,
): string | null {
  // The type check guards against a duplicated @auth/core copy in the bundle.
  const isCredentialsSignin =
    error instanceof CredentialsSignin ||
    (error instanceof AuthError && error.type === "CredentialsSignin");
  if (!isCredentialsSignin) return null;
  return `/signin?error=CredentialsSignin&callbackUrl=${encodeURIComponent(safePath)}`;
}
