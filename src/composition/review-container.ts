import { createReviewQueue } from "@/application/review/review-queue";
import { getCachedCurrentUser } from "@/composition/current-user";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { createReviewStore } from "@/infrastructure/prisma/review-store";

// Today's reviews, read and answered in the database as the signed-in user.
export const reviews = createReviewQueue({
  currentUser: getCachedCurrentUser,
  store: createReviewStore(prisma),
  now: () => new Date(),
});
