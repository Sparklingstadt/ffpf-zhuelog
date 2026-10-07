import type { ConversationNoteRepository } from "../../../domain/chat/repositories/conversation-note-repository";

export class RestoreConversation {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(ownerId: string, id: string) {
    return this.repository.restore(ownerId, id);
  }
}
