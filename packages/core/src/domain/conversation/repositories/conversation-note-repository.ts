import type {
  ConversationNote,
  ConversationNoteDraft,
  ConversationNoteSummary,
} from "../entities/conversation-note";
import type { DateRange } from "../../learning/value-objects/log-date";

export type DailyConversationNote = {
  note: ConversationNote;
  total: number;
};

export interface ConversationNoteRepository {
  create(draft: ConversationNoteDraft): Promise<ConversationNoteSummary>;
  /** Replaces the saved messages; resolves null when the note no longer exists. */
  update(
    id: string,
    draft: ConversationNoteDraft,
  ): Promise<ConversationNoteSummary | null>;
  listCreatedAt(): Promise<Date[]>;
  listByDate(range: DateRange): Promise<ConversationNoteSummary[]>;
  getByDateAndNumber(
    range: DateRange,
    noteNumber: number,
  ): Promise<DailyConversationNote | null>;
}
