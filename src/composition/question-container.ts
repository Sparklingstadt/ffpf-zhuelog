import { createQuestionNotes } from "@/application/chat/question-notes";
import { getCachedCurrentUser } from "@/composition/current-user";
import { openAiConfig } from "@/infrastructure/config/environment";
import { streamAnswer } from "@/infrastructure/openai/answer-stream";
import { QUICK_QUESTION_INSTRUCTIONS } from "@/infrastructure/openai/quick-question";
import { recordAiUsage } from "@/infrastructure/prisma/ai-usage-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { createQuestionStore } from "@/infrastructure/prisma/question-store";

// Read once at module load; Vercel needs a redeploy for env changes anyway.
const openAi = openAiConfig();

// The signed-in user's question notes, kept in the database, and quick
// questions answered by OpenAI when it is configured.
export const questionNotes = createQuestionNotes({
  currentUser: getCachedCurrentUser,
  store: createQuestionStore(prisma),
  chatModel: openAi?.chatModel,
  answer: openAi
    ? (text, signal, onUsage) =>
        streamAnswer(
          openAi,
          {
            model: openAi.chatModel,
            instructions: QUICK_QUESTION_INSTRUCTIONS,
            messages: [{ role: "user", text }],
            requireComplete: true,
          },
          { signal, onUsage },
        )
    : undefined,
  recordUsage: (entry) => recordAiUsage(prisma, entry),
  logError: (code, ...details) => console.error(code, ...details),
  now: () => new Date(),
});
