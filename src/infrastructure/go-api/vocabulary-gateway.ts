import type {
  VocabularyDraft,
  VocabularyEntry,
} from "@/domain/vocabulary/vocabulary-entry";

import { goApiAuthed, type GoApiCall } from "./authed";

type EntryJson = Omit<VocabularyEntry, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

const toEntry = (json: EntryJson): VocabularyEntry => ({
  id: json.id,
  language: json.language,
  word: json.word,
  pinyin: json.pinyin,
  meaning: json.meaning,
  sourceEntryId: json.sourceEntryId,
  createdAt: new Date(json.createdAt),
  updatedAt: new Date(json.updatedAt),
});

const path = (id: string) => `/v1/vocabulary/${encodeURIComponent(id)}`;

// The vocabulary book is always the signed-in user's own (the token's owner
// in Go, or the member an admin acts as).
export function createVocabularyGateway(call: GoApiCall = goApiAuthed) {
  return {
    // Newest first.
    async list(): Promise<VocabularyEntry[]> {
      const json = await call<{ entries: EntryJson[] }>("/v1/vocabulary", {
        method: "GET",
      });
      return json.entries.map(toEntry);
    },

    // Adds the word under the id the browser made, or, for an id already
    // saved, rewrites its pinyin and meaning. A new word is queued for review.
    async save(entry: {
      id: string;
      word: string;
      pinyin: string;
      meaning: string;
      sourceEntryId?: string;
    }): Promise<VocabularyEntry> {
      return toEntry(
        await call<EntryJson>(path(entry.id), {
          method: "PUT",
          body: {
            word: entry.word,
            pinyin: entry.pinyin,
            meaning: entry.meaning,
            ...(entry.sourceEntryId
              ? { sourceEntryId: entry.sourceEntryId }
              : {}),
          },
        }),
      );
    },

    async remove(id: string): Promise<void> {
      await call<unknown>(path(id), { method: "DELETE" });
    },

    // AI's pinyin and meaning for word, as used in sentence. Nothing is saved.
    async draft(word: string, sentence: string): Promise<VocabularyDraft> {
      return call<VocabularyDraft>("/v1/vocabulary/draft", {
        method: "POST",
        body: { word, sentence },
      });
    },
  };
}

export type VocabularyGateway = ReturnType<typeof createVocabularyGateway>;
