import type { LearningChatMessage } from "../../../domain/chat/entities/chat-message";

export type LearningChatRequest = {
  // Aborts the generation, e.g. when the reader goes away.
  signal?: AbortSignal;
  messages: LearningChatMessage[];
  systemPrompt: string;
  maxOutputTokens: number;
};

export interface LearningChatGateway {
  // Yields the answer text as it arrives. Failures are LearningChatError when
  // their message may be shown; LearningChatBusyError is thrown before any
  // generation starts.
  stream(request: LearningChatRequest): AsyncIterable<string>;
}
