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
      model: openai(getOpenAiModelName()),
      system: request.systemPrompt,
      messages,
      maxOutputTokens: request.maxOutputTokens,
      providerOptions: { openai: { store: false } },
    });

    return result.toUIMessageStreamResponse({
      onError: () => "ChatGPTから応答を受信できませんでした。",
    });
  }
}
