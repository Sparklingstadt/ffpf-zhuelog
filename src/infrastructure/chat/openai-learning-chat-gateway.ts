import { openai } from "@ai-sdk/openai";
import { streamText, type ModelMessage } from "ai";

import type {
  LearningChatGateway,
  LearningChatRequest,
} from "@/application/chat/ports/learning-chat-gateway";
import { getOpenAiModelName } from "@/infrastructure/config/environment";

export class OpenAiLearningChatGateway implements LearningChatGateway {
  stream(request: LearningChatRequest): Response {
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
      providerOptions: { openai: { store: false } },
    });

    return result.toUIMessageStreamResponse({
      headers: { "Cache-Control": "no-store" },
      onError: () => "ChatGPTから応答を受信できませんでした。",
    });
  }
}
