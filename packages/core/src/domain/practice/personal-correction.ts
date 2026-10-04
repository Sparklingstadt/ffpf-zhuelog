import { z } from "zod";
import { correctionSchema } from "../learning/chinese-correction";

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
    id: z.uuid(),
    originalText: z.string().min(1).max(500),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PersonalCorrectionRecord = z.infer<
  typeof personalCorrectionRecordSchema
>;

// Why a correction failed. Screen text and request-level rejections
// (login, origin, body size) belong to presentation.
export const CORRECTION_FAILURES = [
  "invalid",
  "key",
  "limited",
  "timeout",
  "unavailable",
] as const;
export type CorrectionFailure = (typeof CORRECTION_FAILURES)[number];
export class PersonalCorrectionError extends Error {
  constructor(public readonly code: CorrectionFailure) {
    super(code);
  }
}
