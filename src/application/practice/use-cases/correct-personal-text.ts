import { correctionSchema } from "../../../domain/learning/chinese-correction";
import {
  personalCorrectionRequestSchema,
  PersonalCorrectionError,
} from "../../../domain/practice/personal-correction";
import type { PersonalCorrectionGateway } from "../ports/personal-correction-gateway";

export class CorrectPersonalText {
  constructor(private readonly gateway: PersonalCorrectionGateway) {}

  async execute(input: unknown, signal: AbortSignal) {
    const parsed = personalCorrectionRequestSchema.safeParse(input);
    if (!parsed.success) throw new PersonalCorrectionError("invalid");
    const { originalText, apiKey } = parsed.data;
    if (originalText.includes(apiKey))
      throw new PersonalCorrectionError("invalid");
    const result = correctionSchema.safeParse(
      await this.gateway.correct(originalText, apiKey, signal),
    );
    if (!result.success) throw new PersonalCorrectionError("unavailable");
    return { originalText, ...result.data };
  }
}
