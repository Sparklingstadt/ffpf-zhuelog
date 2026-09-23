import type { LearningChatMessage } from "@/domain/chat/entities/chat-message";

export type LearningChatRequest = {
  signal?: AbortSignal;
  messages: LearningChatMessage[];
  systemPrompt: string;
  maxOutputTokens: number;
};

export interface LearningChatGateway {
  stream(request: LearningChatRequest): Response;
}
