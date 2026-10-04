import type { Conversation, ConversationSummary } from "../conversation";
export interface ConversationRepository {
  save(ownerId: string, conversation: Conversation): Promise<Conversation>;
  list(ownerId: string): Promise<ConversationSummary[]>;
  get(ownerId: string, id: string): Promise<Conversation | null>;
}
