// A word the signed-in user picked out to learn, as the Go API keeps it.
// sourceEntryId is the learning note it came from, or null.
export type VocabularyEntry = {
  id: string;
  language: string;
  word: string;
  pinyin: string;
  meaning: string;
  sourceEntryId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// What a review card of kind "vocabulary" shows.
export type VocabularyCard = Pick<
  VocabularyEntry,
  "id" | "word" | "pinyin" | "meaning"
>;

// The reading and meaning AI suggests, for the user to edit before saving.
export type VocabularyDraft = { pinyin: string; meaning: string };

// The lengths Go accepts, in characters.
export const VOCABULARY_LIMITS = {
  word: 20,
  pinyin: 100,
  meaning: 200,
  sentence: 300,
} as const;
