// A word the signed-in user picked out to learn, as the vocabulary book stores it.
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
  // When its review card is next due, in the list only; null otherwise.
  nextReview: Date | null;
};

// What a review card of kind "vocabulary" shows.
export type VocabularyCard = Pick<
  VocabularyEntry,
  "id" | "word" | "pinyin" | "meaning"
>;

// The reading and meaning AI suggests, for the user to edit before saving.
export type VocabularyDraft = { pinyin: string; meaning: string };

// The longest each field may be, in characters.
export const VOCABULARY_LIMITS = {
  word: 20,
  pinyin: 100,
  meaning: 200,
  sentence: 300,
} as const;

// Tokens one OpenAI call spent, to be recorded as AI usage.
export type OpenAiUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// What the user submits to save a word. The id comes from the client, so a
// retried save is applied once; sourceEntryId is the note the word came from.
export type VocabularyInput = {
  id: string;
  word: string;
  pinyin: string;
  meaning: string;
  sourceEntryId?: string;
};
