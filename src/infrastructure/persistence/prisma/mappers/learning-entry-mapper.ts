import type { LearningEntry } from "@/domain/learning/entities/learning-entry";

type PrismaLearningEntryRecord = {
  id: string;
  originalText: string;
  correctedText: string;
  pinyin: string;
  createdAt: Date;
  hints: { id: string; content: string; position: number }[];
};

export function toLearningEntry(record: PrismaLearningEntryRecord): LearningEntry {
  return {
    id: record.id,
    originalText: record.originalText,
    correctedText: record.correctedText,
    pinyin: record.pinyin,
    createdAt: record.createdAt,
    hints: record.hints.map((hint) => ({ ...hint })),
  };
}
