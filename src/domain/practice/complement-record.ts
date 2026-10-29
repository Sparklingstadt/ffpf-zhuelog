import type { ComplementMode } from "./complement-quiz";
import type {
  PrepositionAnswer,
  PrepositionRecordSummary,
} from "./preposition-record";
export type ComplementAnswer = PrepositionAnswer;
export type ComplementRecordSummary = PrepositionRecordSummary & {
  mode: ComplementMode;
};
export type ComplementRecord = ComplementRecordSummary & {
  questions: ComplementAnswer[];
};
export {
  accuracyPercent,
  formatElapsed,
  scoreRound,
} from "./preposition-record";
