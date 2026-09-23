import { z } from "zod";
import { correctionSchema } from "../learning/chinese-correction";

export const PERSONAL_CORRECTION_MODEL = "gpt-5-mini";
export const personalCorrectionRequestSchema = z
  .object({
    apiKey: z
      .string()
      .trim()
      .regex(/^sk-[A-Za-z0-9_-]{16,500}$/),
    originalText: z.string().trim().min(1).max(500),
    consent: z.literal(true),
  })
  .strict();
export type PersonalCorrectionRequest = z.infer<
  typeof personalCorrectionRequestSchema
>;

// Explicit allowlist: credentials can never be serialized into history.
export const personalCorrectionRecordSchema = correctionSchema
  .extend({
    id: z.string().uuid(),
    originalText: z.string().min(1).max(500),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PersonalCorrectionRecord = z.infer<
  typeof personalCorrectionRecordSchema
>;

export const correctionErrors = {
  invalid: "入力・APIキー・同意を確認してください（原文は500文字以内）。",
  unauthorized: "ログインし直してください。",
  origin: "この画面から送信してください。",
  tooLarge: "送信するデータが大きすぎます。",
  key: "APIキーが無効か、このモデルを利用する権限がありません。",
  limited: "利用上限・残高・連続送信制限を確認し、時間をおいてお試しください。",
  timeout:
    "応答が時間内に届きませんでした。自動再試行はしません。OpenAI側で料金が発生している可能性があります。",
  unavailable:
    "添削結果を取得できませんでした。自動再試行はしません。OpenAI側で料金が発生している可能性があります。",
} as const;
export type CorrectionErrorCode = keyof typeof correctionErrors;
export class PersonalCorrectionError extends Error {
  constructor(public readonly code: CorrectionErrorCode) {
    super(correctionErrors[code]);
  }
}
