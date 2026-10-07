import { EmptyConversationTrash } from "@ffpf-zhuelog/core/application/chat/use-cases/empty-conversation-trash";
import { GetDailyConversation } from "@ffpf-zhuelog/core/application/chat/use-cases/get-daily-conversation";
import { ListConversationDates } from "@ffpf-zhuelog/core/application/chat/use-cases/list-conversation-dates";
import { ListDailyConversations } from "@ffpf-zhuelog/core/application/chat/use-cases/list-daily-conversations";
import { ListTrashedConversations } from "@ffpf-zhuelog/core/application/chat/use-cases/list-trashed-conversations";
import { PurgeConversation } from "@ffpf-zhuelog/core/application/chat/use-cases/purge-conversation";
import { RestoreConversation } from "@ffpf-zhuelog/core/application/chat/use-cases/restore-conversation";
import { TrashConversation } from "@ffpf-zhuelog/core/application/chat/use-cases/trash-conversation";
import { PrismaConversationRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-conversation-repository";
export const conversationRepository = new PrismaConversationRepository();
export const conversationNoteUseCases = {
  listConversationDates: new ListConversationDates(conversationRepository),
  listDailyConversations: new ListDailyConversations(conversationRepository),
  getDailyConversation: new GetDailyConversation(conversationRepository),
  trashConversation: new TrashConversation(conversationRepository),
  restoreConversation: new RestoreConversation(conversationRepository),
  purgeConversation: new PurgeConversation(conversationRepository),
  emptyConversationTrash: new EmptyConversationTrash(conversationRepository),
  listTrashedConversations: new ListTrashedConversations(
    conversationRepository,
  ),
};
