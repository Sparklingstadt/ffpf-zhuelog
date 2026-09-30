import { PrismaConversationRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-conversation-repository";
export const conversationRepository = new PrismaConversationRepository();
