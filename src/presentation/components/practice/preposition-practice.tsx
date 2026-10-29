"use client";
import type { PrepositionQuestion } from "@/domain/practice/preposition-quiz";
import { buildQuiz } from "@/domain/practice/preposition-quiz";
import { savePrepositionRoundAction } from "@/presentation/actions/preposition-record-actions";
import { ChoicePractice } from "./choice-practice";

export function PrepositionPractice({
  initialQuiz,
  canSave,
}: {
  initialQuiz: PrepositionQuestion[];
  canSave: boolean;
}) {
  return (
    <ChoicePractice
      initialQuiz={initialQuiz}
      canSave={canSave}
      buildNextQuiz={() => buildQuiz(initialQuiz.length)}
      saveRound={savePrepositionRoundAction}
      recordsHref="/practice/prepositions/records"
      choiceLabel="介詞を選ぶ"
    />
  );
}
