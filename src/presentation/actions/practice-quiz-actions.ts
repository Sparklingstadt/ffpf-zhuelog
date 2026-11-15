"use server";

import { getCurrentViewerUser } from "@/composition/identity-container";
import {
  PRACTICE_QUESTION_COUNT,
  type ChoiceQuestion,
} from "@/domain/practice/choice-question";
import { parseHskLevel, type HskLevel } from "@/domain/practice/hsk-level";
import {
  buildPracticeQuiz,
  parsePracticeQuizKind,
  type PracticeQuizKind,
} from "@/domain/practice/practice-quiz";
import { readHskBasis } from "@/infrastructure/preferences/hsk-basis-cookie";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";

export type NextPracticeQuizResult =
  { ok: true; quiz: ChoiceQuestion[] } | { ok: false; message: string };

// Builds the next round of a practice for "もう一度". It runs on the server
// so the question data (hundreds of KB) never ships to the browser. The HSK
// basis comes from the same cookie the page read.
export async function nextPracticeQuizAction(
  kind: PracticeQuizKind,
  level: HskLevel | null,
): Promise<NextPracticeQuizResult> {
  const user = await getCurrentViewerUser();
  if (!user) return { ok: false, message: accountForbiddenMessage };
  const parsedKind = parsePracticeQuizKind(kind);
  if (!parsedKind)
    return { ok: false, message: "練習の種類が正しくありません。" };
  const parsedLevel = level === null ? null : parseHskLevel(level);
  const filter = parsedLevel
    ? { level: parsedLevel, basis: await readHskBasis() }
    : null;
  return {
    ok: true,
    quiz: buildPracticeQuiz(
      parsedKind,
      PRACTICE_QUESTION_COUNT,
      Math.random,
      filter,
    ),
  };
}
