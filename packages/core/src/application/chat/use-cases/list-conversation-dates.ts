import type { ConversationNoteRepository } from "../../../domain/chat/repositories/conversation-note-repository";
import { ListLogDates } from "../../calendar/use-cases/list-log-dates";

export class ListConversationDates {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(ownerId: string) {
    return new ListLogDates(this.repository).execute(ownerId);
  }
}
