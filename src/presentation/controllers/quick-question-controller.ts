import type { QuestionNotes } from "@/application/chat/question-notes";
import { quickQuestionText } from "@/domain/chat/question";
import { handleAnswerRequest } from "./answer-request-controller";

// POST /api/quick-question: one question to OpenAI, the answer streamed
// back as NDJSON.
export async function handleQuickQuestion(
  request: Request,
  deps: { asker: () => ReturnType<QuestionNotes["asker"]> },
): Promise<Response> {
  return handleAnswerRequest(request, {
    asker: deps.asker,
    read: quickQuestionText,
  });
}
