import { GetDailyConversation } from "@ffpf-zhuelog/core/application/conversation/use-cases/get-daily-conversation";
import { ListDailyConversations } from "@ffpf-zhuelog/core/application/conversation/use-cases/list-daily-conversations";
import { SaveConversationNote } from "@ffpf-zhuelog/core/application/conversation/use-cases/save-conversation-note";
import { ListLogDates } from "@ffpf-zhuelog/core/application/learning/use-cases/list-log-dates";
import { PrismaConversationNoteRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-conversation-note-repository";

const repository = new PrismaConversationNoteRepository();

export const conversationUseCases = {
  saveConversationNote: new SaveConversationNote(repository),
  listConversationDates: new ListLogDates(repository),
  listDailyConversations: new ListDailyConversations(repository),
  getDailyConversation: new GetDailyConversation(repository),
};
