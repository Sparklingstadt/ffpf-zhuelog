import type { ConversationNoteRepository } from "../../../domain/chat/repositories/conversation-note-repository";

export class EmptyConversationTrash {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(ownerId: string) {
    return this.repository.emptyTrash(ownerId);
  }
}
