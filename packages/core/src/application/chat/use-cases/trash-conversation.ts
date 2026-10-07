import type { ConversationNoteRepository } from "../../../domain/chat/repositories/conversation-note-repository";

export class TrashConversation {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(ownerId: string, id: string) {
    return this.repository.trash(ownerId, id);
  }
}
