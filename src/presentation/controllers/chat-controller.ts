import type { ConversationNotes } from "@/application/chat/conversation-notes";
import { chatTurns } from "@/domain/chat/conversation";
import { handleAnswerRequest } from "./answer-request-controller";

// POST /api/chat: the conversation so far to OpenAI, the answer streamed
// back as NDJSON.
export async function handleChat(
  request: Request,
  deps: { chatter: () => ReturnType<ConversationNotes["chatter"]> },
): Promise<Response> {
  return handleAnswerRequest(request, {
    asker: deps.chatter,
    read: chatTurns,
  });
}
