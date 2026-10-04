import { openai } from "@ai-sdk/openai";
import { streamText, type ModelMessage } from "ai";

import type {
  LearningChatGateway,
  LearningChatRequest,
} from "@ffpf-zhuelog/core/application/chat/ports/learning-chat-gateway";
import { LearningChatError } from "@ffpf-zhuelog/core/domain/chat/learning-chat-error";
import { getOpenAiModelName } from "@/infrastructure/config/environment";

const FAILURE = "ChatGPTから応答を受信できませんでした。";

export class OpenAiLearningChatGateway implements LearningChatGateway {
  async *stream(request: LearningChatRequest): AsyncIterable<string> {
    const messages: ModelMessage[] = request.messages.map((message) => ({
      role: message.role,
      content: message.text,
    }));
    const result = streamText({
      abortSignal: request.signal,
      model: openai(getOpenAiModelName()),
      system: request.systemPrompt,
      messages,
      maxOutputTokens: request.maxOutputTokens,
      maxRetries: 0,
      timeout: 45_000,
      onError: () => console.error("LEARNING_CHAT_PROVIDER_ERROR"),
      providerOptions: { openai: { store: false, reasoningEffort: "medium" } },
    });
    // textStream hides errors, so read every event and keep only the text.
    try {
      for await (const part of result.stream) {
        if (part.type === "text-delta") yield part.text;
        else if (part.type === "error") throw new LearningChatError(FAILURE);
      }
    } catch (error) {
      if (error instanceof LearningChatError) throw error;
      throw new LearningChatError(FAILURE);
    }
  }
}
