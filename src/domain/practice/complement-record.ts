import { COMPLEMENT_MODES, type ComplementMode } from "./complement-quiz";
import { MEASURE_WORD_PRACTICE } from "./measure-word-quiz";
import type {
  PrepositionAnswer,
  PrepositionRecordSummary,
} from "./preposition-record";
export type ComplementAnswer = PrepositionAnswer;
export type ComplementRecordSummary = PrepositionRecordSummary & {
  mode: ComplementRoundMode;
};
export type ComplementRecord = ComplementRecordSummary & {
  questions: ComplementAnswer[];
};
export {
  accuracyPercent,
  formatElapsed,
  scoreRound,
} from "./preposition-record";

// The modes a saved round may have: the complement modes, and "measure" for
// the measure-word practice, whose rounds are kept with the complements'.
export type ComplementRoundMode = ComplementMode | "measure";

export const COMPLEMENT_ROUND_MODES = [
  ...(Object.keys(COMPLEMENT_MODES) as ComplementMode[]),
  "measure",
] as const satisfies readonly ComplementRoundMode[];

// How a round's mode is named in the record lists.
export function roundModeLabel(mode: ComplementRoundMode): string {
  return mode === "measure"
    ? MEASURE_WORD_PRACTICE.label
    : COMPLEMENT_MODES[mode].label;
}
