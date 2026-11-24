import { createMemberAccounts } from "@/application/identity/member-accounts";
import { createOwnPassword } from "@/application/identity/own-password";
import { getCachedCurrentUser } from "@/composition/current-user";
import { createPasswordAccountStore } from "@/infrastructure/prisma/password-account-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { createSignInThrottleStore } from "@/infrastructure/prisma/sign-in-throttle-store";
import {
  generatePassword,
  ScryptPasswordHasher,
} from "@/infrastructure/security/scrypt-password-hasher";

const passwords = new ScryptPasswordHasher();
const accounts = createPasswordAccountStore(prisma);

// Member accounts (admins only), read and written in the database.
export const memberAccounts = createMemberAccounts({
  currentUser: getCachedCurrentUser,
  store: accounts,
  hashPassword: (password) => passwords.hash(password),
  generatePassword,
  now: () => new Date(),
});

// A member's own password change, counted in SignInThrottle like sign-in.
export const ownPassword = createOwnPassword({
  currentUser: getCachedCurrentUser,
  accounts,
  passwords,
  throttle: createSignInThrottleStore(prisma),
  now: () => new Date(),
});
