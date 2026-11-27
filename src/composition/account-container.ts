import { headers } from "next/headers";

import { createMemberAccounts } from "@/application/identity/member-accounts";
import { getCachedCurrentUser } from "@/composition/current-user";
import { auth } from "@/infrastructure/auth/better-auth";
import { generatePassword } from "@/infrastructure/security/scrypt-password-hasher";

// Member accounts (admins only), through Better Auth's admin plugin with the
// admin's own request headers. Server-side auth.api calls are allowed for the
// admin's features (they are not sign-ins for the rate limit to count).
export const memberAccounts = createMemberAccounts({
  currentUser: getCachedCurrentUser,
  headers,
  api: auth.api,
  generatePassword,
});
