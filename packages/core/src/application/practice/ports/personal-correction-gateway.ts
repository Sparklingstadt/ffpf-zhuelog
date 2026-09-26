import type { Correction } from "../../../domain/learning/chinese-correction";

export interface PersonalCorrectionGateway {
  correct(
    originalText: string,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<Correction>;
}
