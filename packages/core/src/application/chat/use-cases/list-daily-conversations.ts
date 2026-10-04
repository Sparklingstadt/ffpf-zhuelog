import type { ConversationNoteRepository } from "../../../domain/chat/repositories/conversation-note-repository";
import {
  getTokyoDateRange,
  type LogDate,
} from "../../../domain/calendar/value-objects/log-date";

export class ListDailyConversations {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(ownerId: string, date: LogDate) {
    return this.repository.listByDate(ownerId, getTokyoDateRange(date));
  }
}
