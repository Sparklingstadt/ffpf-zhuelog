import { conversationSchema } from "../../../domain/chat/conversation";
import type { ConversationRepository } from "../../../domain/chat/repositories/conversation-repository";
export class SaveConversation {
  constructor(private readonly repository: ConversationRepository) {}
  execute(ownerId: string, input: unknown) {
    if (!ownerId) throw new Error("REAUTH_REQUIRED");
    return this.repository.save(ownerId, conversationSchema.parse(input));
  }
}
