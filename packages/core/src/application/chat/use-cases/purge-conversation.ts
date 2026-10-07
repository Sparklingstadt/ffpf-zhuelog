import type { ConversationNoteRepository } from "../../../domain/chat/repositories/conversation-note-repository";

export class PurgeConversation {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(ownerId: string, id: string) {
    return this.repository.purge(ownerId, id);
  }
}
