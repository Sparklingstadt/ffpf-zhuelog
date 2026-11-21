import { cache } from "react";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import {
  readActAsCookie,
  readSessionToken,
} from "@/infrastructure/auth/web-session";
import {
  allowedGitHubIds,
  demoLoginId,
} from "@/infrastructure/config/environment";
import { SessionCurrentUserProvider } from "@/infrastructure/identity/session-current-user-provider";
import { prismaIdentityAccounts } from "@/infrastructure/prisma/identity-accounts";
import { sessionStore } from "./sign-in-container";

// The allowlist (AUTH_ALLOWED_GITHUB_IDS) and the demo login id are read
// once, when this module loads, as before: a change to them needs a
// redeploy (Vercel needs one for any env change anyway). Everything else
// (the Session row, sessionVersion, zl_act_as) is checked on every request.
const provider = new SessionCurrentUserProvider(
  readSessionToken,
  readActAsCookie,
  (token) => sessionStore.find(token, new Date()),
  prismaIdentityAccounts,
  { allowedGitHubIds: allowedGitHubIds(), demoLoginId: demoLoginId() },
);

// The signed-in user, resolved at most once per request however many guards
// and pages ask. Kept apart from identity-container so other containers can
// use it without an import cycle.
export const getCachedCurrentUser = cache(
  (): Promise<AuthenticatedUser | null> => provider.getCurrentUser(),
);
