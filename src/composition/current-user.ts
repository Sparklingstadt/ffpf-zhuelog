import { headers } from "next/headers";
import { cache } from "react";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { auth } from "@/infrastructure/auth/better-auth";
import { demoLoginId } from "@/infrastructure/config/environment";
import { BetterAuthCurrentUserProvider } from "@/infrastructure/identity/better-auth-current-user-provider";

// The demo login id is read once, when this module loads: a change to it
// needs a redeploy (Vercel needs one for any env change anyway). The session
// (its expiry, the user's role, ban and impersonation) is checked on every
// request.
const provider = new BetterAuthCurrentUserProvider(
  async () => auth.api.getSession({ headers: await headers() }),
  demoLoginId(),
);

// The signed-in user, resolved at most once per request however many guards
// and pages ask. Kept apart from identity-container so other containers can
// use it without an import cycle.
export const getCachedCurrentUser = cache(
  (): Promise<AuthenticatedUser | null> => provider.getCurrentUser(),
);
