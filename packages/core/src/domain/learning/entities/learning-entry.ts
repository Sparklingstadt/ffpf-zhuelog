export type LearningHint = {
  id: string;
  content: string;
  position: number;
};

export const LEARNING_KINDS = ["correction", "translation"] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];

export type LearningEntry = {
  id: string;
  kind: LearningKind;
  originalText: string;
  correctedText: string;
  pinyin: string;
  createdAt: Date;
  hints: LearningHint[];
};

export type LearningEntryDraft = {
  // Stored as "correction" when omitted.
  kind?: LearningKind;
  originalText: string;
  correctedText: string;
  pinyin: string;
  hints: string[];
};
