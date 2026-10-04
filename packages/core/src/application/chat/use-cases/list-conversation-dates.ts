import type { ConversationNoteRepository } from "../../../domain/chat/repositories/conversation-note-repository";
import { ListLogDates } from "../../learning/use-cases/list-log-dates";

export class ListConversationDates {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(ownerId: string) {
    return new ListLogDates({
      listCreatedAt: () => this.repository.listCreatedAt(ownerId),
    }).execute();
  }
}
