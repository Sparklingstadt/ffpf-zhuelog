import type { ConversationNoteRepository } from "../../../domain/chat/repositories/conversation-note-repository";
import {
  getTokyoDateRange,
  type LogDate,
} from "../../../domain/learning/value-objects/log-date";

export class GetDailyConversation {
  constructor(private readonly repository: ConversationNoteRepository) {}

  execute(ownerId: string, date: LogDate, noteNumber: number) {
    return this.repository.getByDateAndNumber(
      ownerId,
      getTokyoDateRange(date),
      noteNumber,
    );
  }
}
