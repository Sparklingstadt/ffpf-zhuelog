import { cache } from "react";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import {
  allowedGitHubIds,
  apiJwtSecret,
  demoLoginId,
} from "@/infrastructure/config/environment";
import {
  readAccessToken,
  readActAsCookie,
} from "@/infrastructure/go-api/go-api-session";
import { verifyAccessToken } from "@/infrastructure/identity/access-token";
import { TokenCurrentUserProvider } from "@/infrastructure/identity/token-current-user-provider";
import { prismaIdentityAccounts } from "@/infrastructure/prisma/identity-accounts";

const provider = new TokenCurrentUserProvider(
  readAccessToken,
  readActAsCookie,
  (t) => verifyAccessToken(t, apiJwtSecret()),
  prismaIdentityAccounts,
  { allowedGitHubIds: allowedGitHubIds(), demoLoginId: demoLoginId() },
);

// The signed-in user, resolved at most once per request however many guards,
// pages and Go API calls (confirmedActAs) ask. Kept apart from
// identity-container so the Go API gateways can use it without an import
// cycle.
export const getCachedCurrentUser = cache(
  (): Promise<AuthenticatedUser | null> => provider.getCurrentUser(),
);
