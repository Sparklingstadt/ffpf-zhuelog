import { createAiUsageSummary } from "@/application/ai-usage/ai-usage-summary";
import { getCachedCurrentUser } from "@/composition/current-user";
import { createAiUsageStore } from "@/infrastructure/prisma/ai-usage-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";

// The admin's monthly summary of OpenAI usage, read in the database.
export const aiUsage = createAiUsageSummary({
  currentUser: getCachedCurrentUser,
  store: createAiUsageStore(prisma),
  now: () => new Date(),
});
