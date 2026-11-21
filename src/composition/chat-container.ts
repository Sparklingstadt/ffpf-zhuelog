import { createConversationNotes } from "@/application/chat/conversation-notes";
import { getCachedCurrentUser } from "@/composition/current-user";
import { openAiConfig } from "@/infrastructure/config/environment";
import { streamAnswer } from "@/infrastructure/openai/answer-stream";
import { CHAT_INSTRUCTIONS } from "@/infrastructure/openai/chat";
import { recordAiUsage } from "@/infrastructure/prisma/ai-usage-store";
import { createConversationStore } from "@/infrastructure/prisma/conversation-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";

// Read once at module load; Vercel needs a redeploy for env changes anyway.
const openAi = openAiConfig();

// The signed-in user's saved conversations, kept in the database, and chats
// answered by OpenAI when it is configured. An answer cut at the token limit
// still ends normally (requireComplete: false), as Go's did.
export const conversationNotes = createConversationNotes({
  currentUser: getCachedCurrentUser,
  store: createConversationStore(prisma),
  chatModel: openAi?.chatModel,
  answer: openAi
    ? (turns, signal, onUsage) =>
        streamAnswer(
          openAi,
          {
            model: openAi.chatModel,
            instructions: CHAT_INSTRUCTIONS,
            messages: turns,
            requireComplete: false,
          },
          { signal, onUsage },
        )
    : undefined,
  recordUsage: (entry) => recordAiUsage(prisma, entry),
  logError: (code, ...details) => console.error(code, ...details),
  now: () => new Date(),
});
