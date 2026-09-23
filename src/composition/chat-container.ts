import { StreamLearningChat } from "@/application/chat/use-cases/stream-learning-chat";
import { OpenAiLearningChatGateway } from "@/infrastructure/chat/openai-learning-chat-gateway";
import { CodexLocalLearningChatGateway } from "@/infrastructure/chat/codex-local-learning-chat-gateway";
import { isCodexLocalRequested } from "@/infrastructure/chat/codex-local-policy";

export const chatUseCases = {
  streamLearningChat: new StreamLearningChat(
    isCodexLocalRequested()
      ? new CodexLocalLearningChatGateway()
      : new OpenAiLearningChatGateway(),
  ),
};
