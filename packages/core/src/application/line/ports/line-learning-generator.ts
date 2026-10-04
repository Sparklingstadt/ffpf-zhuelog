import type { Correction } from "../../../domain/learning/chinese-correction";
import type { Translation } from "../../../domain/learning/chinese-translation";

// Failures are reported as LineGenerationError (see domain/line/generation-failure).
export interface LineLearningGenerator {
  correct(text: string, signal: AbortSignal): Promise<Correction>;
  translate(text: string, signal: AbortSignal): Promise<Translation>;
}
