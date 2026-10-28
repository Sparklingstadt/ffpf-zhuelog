import type {
  QuestionNote,
  QuestionSummary,
  SaveQuestionInput,
} from "@/domain/chat/question";
import { goApiAuthed, type GoApiCall } from "./authed";
import { GoApiError } from "./client";
import { ChatUnavailableError } from "./conversation-gateway";

type SummaryJSON = Omit<QuestionSummary, "createdAt"> & { createdAt: string };
const toSummary = (q: SummaryJSON): QuestionSummary => ({
  ...q,
  createdAt: new Date(q.createdAt),
});

export function createQuestionGateway(call: GoApiCall = goApiAuthed) {
  return {
    async list(): Promise<{ chatModel: string; questions: QuestionSummary[] }> {
      try {
        const data = await call<{
          chatModel: string;
          questions: SummaryJSON[];
        }>("/v1/questions", { method: "GET" });
        return {
          chatModel: data.chatModel,
          questions: data.questions.map(toSummary),
        };
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404)
          throw new ChatUnavailableError();
        throw error;
      }
    },
    async get(id: string): Promise<QuestionNote | null> {
      try {
        const q = await call<SummaryJSON & { answer: string }>(
          `/v1/questions/${encodeURIComponent(id)}`,
          { method: "GET" },
        );
        return { ...toSummary(q), answer: q.answer };
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404) return null;
        throw error;
      }
    },
    async save(input: SaveQuestionInput): Promise<void> {
      await call(`/v1/questions/${encodeURIComponent(input.id)}`, {
        method: "PUT",
        body: { question: input.question, answer: input.answer },
      });
    },
  };
}
