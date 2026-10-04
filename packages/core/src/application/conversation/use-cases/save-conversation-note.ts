import { parseConversationNoteDraft } from "../../../domain/conversation/conversation-note-draft";
import type { ConversationNoteRepository } from "../../../domain/conversation/repositories/conversation-note-repository";

export class SaveConversationNote {
  constructor(private readonly repository: ConversationNoteRepository) {}

  /**
   * Saves a chat as a note. Passing the id of an earlier save updates that note
   * with the continued conversation instead of creating a duplicate.
   */
  async execute(messages: unknown, noteId?: string) {
    const draft = parseConversationNoteDraft(messages);
    if (noteId) {
      const updated = await this.repository.update(noteId, draft);
      if (updated) return updated;
    }
    return this.repository.create(draft);
  }
}
