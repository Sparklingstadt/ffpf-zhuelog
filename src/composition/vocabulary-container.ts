import { createVocabularyBook } from "@/application/vocabulary/vocabulary-book";
import { getCachedCurrentUser } from "@/composition/current-user";
import {
  openAiConfig,
  openAiKeySet,
} from "@/infrastructure/config/environment";
import { respondJson } from "@/infrastructure/openai/responses";
import { draftVocabulary } from "@/infrastructure/openai/vocabulary-draft";
import { recordAiUsage } from "@/infrastructure/prisma/ai-usage-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { createVocabularyStore } from "@/infrastructure/prisma/vocabulary-store";

// Read once at module load; Vercel needs a redeploy for env changes anyway.
const openAi = openAiConfig();
if (!openAi && openAiKeySet())
  // Never log the value itself.
  console.error("OPENAI_API_BASE_URL is not a loopback URL; AI drafts are off");

// The signed-in user's vocabulary book, kept in the database, with AI drafts
// when OpenAI is configured.
export const vocabulary = createVocabularyBook({
  currentUser: getCachedCurrentUser,
  store: createVocabularyStore(prisma),
  draft: openAi
    ? (word, sentence, onUsage) =>
        draftVocabulary(
          (request) => respondJson(openAi, request, onUsage),
          word,
          sentence,
        )
    : undefined,
  recordUsage: ({ ownerId, ...entry }) =>
    recordAiUsage(prisma, { ...entry, userId: ownerId }),
  logError: (code, ...details) => console.error(code, ...details),
});
