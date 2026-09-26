export type LearningHint = {
  id: string;
  content: string;
  position: number;
};

export type LearningEntry = {
  id: string;
  originalText: string;
  correctedText: string;
  pinyin: string;
  createdAt: Date;
  hints: LearningHint[];
};

export type LearningEntryDraft = {
  originalText: string;
  correctedText: string;
  pinyin: string;
  hints: string[];
};
