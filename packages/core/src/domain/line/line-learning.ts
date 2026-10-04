import { z } from "zod";
import type {
  LearningEntryDraft,
  LearningKind,
} from "../learning/entities/learning-entry";
import { correctionSchema } from "../learning/chinese-correction";
import { translationSchema } from "../learning/chinese-translation";

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
  "translation",
  "battery",
  "dev-issue",
  "dev-reply",
  "text-too-long",
] as const;
// The kinds new code creates and claims.
export const ACTIVE_LINE_JOB_KINDS = [
  "correction",
  "translation",
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
  kind: (typeof ACTIVE_LINE_JOB_KINDS)[number];
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

function fromTranslation(output: unknown) {
  const { translatedText, pinyin, hints } = translationSchema.parse(output);
  return { correctedText: translatedText, pinyin, hints };
}

export function makeLineLearningResult(
  kind: LearningKind,
  originalText: string,
  output: unknown,
) {
  // A translation is stored like a correction: its text goes in correctedText.
  const { correctedText, pinyin, hints } =
    kind === "translation"
      ? fromTranslation(output)
      : correctionSchema.parse(output);
  const draft: LearningEntryDraft = {
    originalText,
    correctedText,
    pinyin,
    hints,
    kind,
  };
  // Quote every cell, preserving commas, quotes and embedded newlines.
  const csv = [originalText, correctedText, pinyin, ...hints]
    .map((cell) => `"${cell.replaceAll('"', '""')}"`)
    .join(",");
  if (csv.length > 4900) throw new Error("CSV_TOO_LONG");
  return { draft, csv };
}
