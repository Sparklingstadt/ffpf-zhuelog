import type { ConversationNoteRepository } from "../../../domain/conversation/repositories/conversation-note-repository";
import {
  getTokyoDateRange,
  type LogDate,
} from "../../../domain/learning/value-objects/log-date";

export class ListDailyConversations {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(date: LogDate) {
    return this.repository.listByDate(getTokyoDateRange(date));
  }
}
