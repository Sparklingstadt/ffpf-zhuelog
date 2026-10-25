import { z } from "zod";
import {
  LEARNING_KINDS,
  type LearningEntry,
} from "@/domain/learning/entities/learning-entry";

// An entry as the Go API sends it. Trashed entries add deletedAt and daily
// entries add number; callers read those themselves.
export type GoEntryJson = {
  id: string;
  kind: string;
  originalText: string;
  correctedText: string;
  pinyin: string;
  hints: { id: string; content: string; position: number }[];
  createdAt: string;
  sharedAt: string | null;
};

const learningKindSchema = z.enum(LEARNING_KINDS);

export function toLearningEntry(json: GoEntryJson): LearningEntry {
  return {
    id: json.id,
    kind: learningKindSchema.parse(json.kind),
    originalText: json.originalText,
    correctedText: json.correctedText,
    pinyin: json.pinyin,
    createdAt: toDate(json.createdAt),
    sharedAt: json.sharedAt === null ? null : toDate(json.sharedAt),
    // Same order as the Prisma repository: by position.
    hints: json.hints
      .map(({ id, content, position }) => ({ id, content, position }))
      .sort((a, b) => a.position - b.position),
  };
}

export function toDate(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error("invalid date in Go JSON");
  return date;
}
