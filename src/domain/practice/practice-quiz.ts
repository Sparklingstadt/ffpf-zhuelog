import { buildAspectParticleQuiz } from "./aspect-particle-quiz";
import type { ChoiceQuestion, Random } from "./choice-question";
import {
  buildComplementQuiz,
  isComplementMode,
  type ComplementMode,
} from "./complement-quiz";
import type { HskFilter } from "./hsk-level";
import { buildMeasureWordQuiz } from "./measure-word-quiz";
import { buildQuiz } from "./preposition-quiz";

// Which practice a round is of. The browser names it to ask the server for
// the next round, so the question data never has to reach the browser.
export type PracticeQuizKind =
  | "preposition"
  | "measure-word"
  | "aspect-particle"
  | `complement:${ComplementMode}`;

const PLAIN_KINDS: readonly string[] = [
  "preposition",
  "measure-word",
  "aspect-particle",
];

export function parsePracticeQuizKind(value: unknown): PracticeQuizKind | null {
  if (typeof value !== "string") return null;
  if (PLAIN_KINDS.includes(value)) return value as PracticeQuizKind;
  const mode = value.startsWith("complement:")
    ? value.slice("complement:".length)
    : null;
  return mode !== null && isComplementMode(mode) ? `complement:${mode}` : null;
}

// `count` questions of the practice, only those that pass the HSK filter when
// one is given.
export function buildPracticeQuiz(
  kind: PracticeQuizKind,
  count: number,
  random: Random,
  filter: HskFilter | null = null,
): ChoiceQuestion[] {
  switch (kind) {
    case "preposition":
      return buildQuiz(count, random, undefined, filter);
    case "measure-word":
      return buildMeasureWordQuiz(count, random, filter);
    case "aspect-particle":
      return buildAspectParticleQuiz(count, random, filter);
    default:
      return buildComplementQuiz(
        kind.slice("complement:".length) as ComplementMode,
        count,
        random,
        filter,
      );
  }
}
