"use client";
import type { HskLevel } from "@/domain/practice/hsk-level";
import type { PrepositionQuestion } from "@/domain/practice/preposition-quiz";
import { buildQuiz } from "@/domain/practice/preposition-quiz";
import { savePrepositionRoundAction } from "@/presentation/actions/preposition-record-actions";
import { ChoicePractice } from "./choice-practice";

export function PrepositionPractice({
  initialQuiz,
  canSave,
  level,
}: {
  initialQuiz: PrepositionQuestion[];
  canSave: boolean;
  // The HSK level the questions are of, or null for every question.
  level: HskLevel | null;
}) {
  return (
    <ChoicePractice
      initialQuiz={initialQuiz}
      canSave={canSave}
      buildNextQuiz={() =>
        buildQuiz(initialQuiz.length, Math.random, undefined, level)
      }
      saveRound={savePrepositionRoundAction}
      recordsHref="/practice/prepositions/records"
      choiceLabel="介詞を選ぶ"
    />
  );
}
