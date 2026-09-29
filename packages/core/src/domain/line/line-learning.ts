import type { LearningEntryDraft } from "../learning/entities/learning-entry";
import { correctionSchema } from "../learning/chinese-correction";

export {
  correctionSchema,
  CORRECTION_INSTRUCTIONS as LINE_CORRECTION_INSTRUCTIONS,
} from "../learning/chinese-correction";
export type { Correction } from "../learning/chinese-correction";
export type LineInput = {
  kind: "correction" | "battery" | "development-input";
  eventId: string;
  userId: string;
  originalText: string;
  receivedAt: Date;
};
export type LineJob = Omit<LineInput, "kind"> & {
  kind: string;
  id: string;
  status: string;
  leaseToken: string | null;
  csv: string | null;
  replyText: string | null;
  retryKey: string;
  firstDeliveryAt: Date | null;
  generationTries: number;
  deliveryTries: number;
};

export function makeLineLearningResult(
  originalText: string,
  correction: unknown,
) {
  const parsed = correctionSchema.parse(correction);
  const draft: LearningEntryDraft = { originalText, ...parsed };
  // Quote every cell, preserving commas, quotes and embedded newlines.
  const csv = [
    originalText,
    parsed.correctedText,
    parsed.pinyin,
    ...parsed.hints,
  ]
    .map((cell) => `"${cell.replaceAll('"', '""')}"`)
    .join(",");
  if (csv.length > 4900) throw new Error("CSV_TOO_LONG");
  return { draft, csv };
}
