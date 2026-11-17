import {
  createSignIn,
  type IssuedSession,
} from "@/application/identity/sign-in";
import { createFfpfOidcClient } from "@/infrastructure/auth/ffpf-oidc-client";
import { createGitHubOAuthClient } from "@/infrastructure/auth/github-oauth-client";
import {
  signedInCookieWrites,
  type CookieWrite,
} from "@/infrastructure/auth/session-cookies";
import {
  allowedGitHubIds,
  demoLoginId,
  ffpfIdConfig,
  githubOAuthConfig,
} from "@/infrastructure/config/environment";
import { createFfpfAccountStore } from "@/infrastructure/prisma/ffpf-account-store";
import { createPasswordAccountStore } from "@/infrastructure/prisma/password-account-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { createSessionStore } from "@/infrastructure/prisma/session-store";
import { createSignInThrottleStore } from "@/infrastructure/prisma/sign-in-throttle-store";
import { ScryptPasswordHasher } from "@/infrastructure/security/scrypt-password-hasher";
import { errorName } from "@/presentation/controllers/sign-in-controller";

// Signing in on the web, built once per server instance: the FFPF ID client
// (and so its JWKS cache) and the hasher's warm dummy hash live here. The
// environment (the OAuth apps, the allowlist, the demo login id) is read
// once, when this module loads: as before, a change needs a redeploy.

const passwords = new ScryptPasswordHasher();
// Builds the dummy hash now, so the first unknown login costs one verify like
// the rest (Go: Warm at startup). Never throws.
void passwords.warm();

const github = githubOAuthConfig();
const ffpf = ffpfIdConfig();

export const sessionStore = createSessionStore(prisma);

export const signIn = createSignIn({
  throttle: createSignInThrottleStore(prisma),
  passwordAccounts: createPasswordAccountStore(prisma),
  ffpfAccounts: createFfpfAccountStore(prisma),
  passwords,
  sessions: sessionStore,
  github: github ? createGitHubOAuthClient(github) : null,
  ffpf: ffpf ? createFfpfOidcClient(ffpf) : null,
  allowedGitHubIds: allowedGitHubIds(),
  demoLoginId: demoLoginId(),
  now: () => new Date(),
});

// Ends the browser's previous session (a failure is logged as
// SESSION_END_FAILED with the error's name, never thrown: the new sign-in
// goes on) and returns the cookies to write for the new one. The previous
// token is only ever deleted; it never decides who signs in.
export async function newSessionCookies(
  previousToken: string | undefined,
  session: IssuedSession,
  secure: boolean,
): Promise<CookieWrite[]> {
  if (previousToken) {
    try {
      await sessionStore.end(previousToken);
    } catch (error) {
      console.error("SESSION_END_FAILED", errorName(error));
    }
  }
  return signedInCookieWrites(session, secure);
}
