import type { ConversationNoteRepository } from "../../../domain/chat/repositories/conversation-note-repository";
import { TRASH_LIST_LIMIT } from "../../learning/use-cases/list-trashed-entries";

export class ListTrashedConversations {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(ownerId: string, limit = TRASH_LIST_LIMIT) {
    return this.repository.listTrashed(ownerId, limit);
  }
}
