import { StreamLearningChat } from "@/application/chat/use-cases/stream-learning-chat";
import { OpenAiLearningChatGateway } from "@/infrastructure/chat/openai-learning-chat-gateway";

export const chatUseCases = {
  streamLearningChat: new StreamLearningChat(new OpenAiLearningChatGateway()),
};
