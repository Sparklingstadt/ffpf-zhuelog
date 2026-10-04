import type { ConversationNoteRepository } from "../../../domain/conversation/repositories/conversation-note-repository";
import {
  getTokyoDateRange,
  type LogDate,
} from "../../../domain/learning/value-objects/log-date";

export class GetDailyConversation {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(date: LogDate, noteNumber: number) {
    return this.repository.getByDateAndNumber(
      getTokyoDateRange(date),
      noteNumber,
    );
  }
}
