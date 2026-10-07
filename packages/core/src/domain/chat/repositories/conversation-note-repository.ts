import type { Conversation, ConversationSummary } from "../conversation";
import type { DateRange } from "../../calendar/value-objects/log-date";

export type ConversationNoteSummary = ConversationSummary & {
  messageCount: number;
};

export type DailyConversation = {
  conversation: Conversation;
  total: number;
};

export type TrashedConversationNote = ConversationNoteSummary & {
  // ISO string, like the summary's other timestamps.
  deletedAt: string;
};

export type TrashedConversationNotes = {
  conversations: TrashedConversationNote[];
  total: number;
};

// Saved conversations browsed by JST date like learning notes, plus their
// trash. Conversations in the trash are left out of the date views.
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
  // Same contract as the learning notes' trash: false when the owner has no
  // such conversation in the expected state.
  trash(ownerId: string, id: string): Promise<boolean>;
  restore(ownerId: string, id: string): Promise<boolean>;
  purge(ownerId: string, id: string): Promise<boolean>;
  emptyTrash(ownerId: string): Promise<number>;
  listTrashed(
    ownerId: string,
    limit: number,
  ): Promise<TrashedConversationNotes>;
}
