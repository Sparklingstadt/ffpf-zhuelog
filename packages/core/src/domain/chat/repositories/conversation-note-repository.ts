import type { Conversation, ConversationSummary } from "../conversation";
import type { DateRange } from "../../learning/value-objects/log-date";

export type ConversationNoteSummary = ConversationSummary & {
  messageCount: number;
};

export type DailyConversation = {
  conversation: Conversation;
  total: number;
};

// Read side of saved conversations, browsed by JST date like learning notes.
export interface ConversationNoteRepository {
  listCreatedAt(ownerId: string): Promise<Date[]>;
  listByDate(
    ownerId: string,
    range: DateRange,
  ): Promise<ConversationNoteSummary[]>;
  getByDateAndNumber(
    ownerId: string,
    range: DateRange,
    noteNumber: number,
  ): Promise<DailyConversation | null>;
}
