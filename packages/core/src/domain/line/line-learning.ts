import { z } from "zod";
import type { LearningEntryDraft } from "../learning/entities/learning-entry";
import { correctionSchema } from "../learning/chinese-correction";

export {
  correctionSchema,
  CORRECTION_INSTRUCTIONS as LINE_CORRECTION_INSTRUCTIONS,
} from "../learning/chinese-correction";
export type { Correction } from "../learning/chinese-correction";
// Matches the 500-character limit of corrections.
export const LINE_TEXT_LIMIT = 500;
export const lineTextTooLongReply = `メッセージが${LINE_TEXT_LIMIT}文字を超えているため、処理しませんでした。${LINE_TEXT_LIMIT}文字以内に分けて送ってください。\n学習ノートには保存していません。`;
// Mirrors the LineLearningJob CHECK constraints; a test keeps them in sync.
// "battery", "dev-issue" and "dev-reply" are legacy: old rows may still hold
// them, but new code neither creates nor claims them.
export const LINE_JOB_KINDS = [
  "correction",
  "battery",
  "dev-issue",
  "dev-reply",
  "text-too-long",
] as const;
export type LineJobKind = (typeof LINE_JOB_KINDS)[number];
export const lineJobKindSchema = z.enum(LINE_JOB_KINDS);
export const LINE_JOB_STATUSES = [
  "PENDING",
  "GENERATING",
  "READY",
  "SENDING",
  "SENT",
  "FAILED",
  // Legacy (development mode): such rows only deduplicate redeliveries and
  // are never claimed.
  "IGNORED",
] as const;
export type LineJobStatus = (typeof LINE_JOB_STATUSES)[number];
export const lineJobStatusSchema = z.enum(LINE_JOB_STATUSES);
export type LineInput = {
  kind: "correction" | "text-too-long";
  eventId: string;
  userId: string;
  originalText: string;
  receivedAt: Date;
};
export type LineJob = Omit<LineInput, "kind"> & {
  kind: LineJobKind;
  id: string;
  status: LineJobStatus;
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
