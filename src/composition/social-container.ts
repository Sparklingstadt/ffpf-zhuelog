import { createSocialNetwork } from "@/application/social/social-network";
import { getCachedCurrentUser } from "@/composition/current-user";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { createSocialStore } from "@/infrastructure/prisma/social-store";

// Follows, the member list and the shared-notes timeline, read and
// written in the database as the signed-in user.
export const socialNetwork = createSocialNetwork({
  currentUser: getCachedCurrentUser,
  store: createSocialStore(prisma),
  now: () => new Date(),
});
