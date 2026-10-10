import { z } from "zod";
import {
  LEARNING_KINDS,
  type LearningEntry,
} from "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";

const learningKindSchema = z.enum(LEARNING_KINDS);

type PrismaLearningEntryRecord = {
  id: string;
  kind: string;
  originalText: string;
  correctedText: string;
  pinyin: string;
  createdAt: Date;
  sharedAt: Date | null;
  hints: { id: string; content: string; position: number }[];
};

export function toLearningEntry(
  record: PrismaLearningEntryRecord,
): LearningEntry {
  return {
    id: record.id,
    kind: learningKindSchema.parse(record.kind),
    originalText: record.originalText,
    correctedText: record.correctedText,
    pinyin: record.pinyin,
    createdAt: record.createdAt,
    sharedAt: record.sharedAt,
    hints: record.hints.map((hint) => ({ ...hint })),
  };
}
