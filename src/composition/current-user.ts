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

// Allowlist and demo id are read once at module load; Vercel needs a redeploy
// for env changes anyway.
const secretTooShort = Buffer.byteLength(apiJwtSecret(), "utf8") < 32;

const provider = new TokenCurrentUserProvider(
  readAccessToken,
  readActAsCookie,
  (t) => verifyAccessToken(t, apiJwtSecret()),
  prismaIdentityAccounts,
  { allowedGitHubIds: allowedGitHubIds(), demoLoginId: demoLoginId() },
);

// A secret under 32 bytes makes every access token fail verification, so say
// so once, on the first lookup (never log the value itself). Done here rather
// than at import so unit tests that only import this module stay quiet.
let warned = false;
function warnShortSecretOnce(): void {
  if (!secretTooShort || warned) return;
  warned = true;
  console.error(
    "API_JWT_SECRET is shorter than 32 bytes; every access token will be rejected",
  );
}

// The signed-in user, resolved at most once per request however many guards,
// pages and Go API calls (confirmedActAs) ask. Kept apart from
// identity-container so the Go API gateways can use it without an import
// cycle.
export const getCachedCurrentUser = cache(
  (): Promise<AuthenticatedUser | null> => {
    warnShortSecretOnce();
    return provider.getCurrentUser();
  },
);
