import { GetDailyConversation } from "@ffpf-zhuelog/core/application/chat/use-cases/get-daily-conversation";
import { ListConversationDates } from "@ffpf-zhuelog/core/application/chat/use-cases/list-conversation-dates";
import { ListDailyConversations } from "@ffpf-zhuelog/core/application/chat/use-cases/list-daily-conversations";
import { PrismaConversationRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-conversation-repository";
export const conversationRepository = new PrismaConversationRepository();
export const conversationNoteUseCases = {
  listConversationDates: new ListConversationDates(conversationRepository),
  listDailyConversations: new ListDailyConversations(conversationRepository),
  getDailyConversation: new GetDailyConversation(conversationRepository),
};
