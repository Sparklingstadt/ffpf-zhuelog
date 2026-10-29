"use client";
import {
  buildComplementQuiz,
  type ComplementMode,
} from "@/domain/practice/complement-quiz";
import type { PrepositionQuestion } from "@/domain/practice/preposition-quiz";
import { saveComplementRoundAction } from "@/presentation/actions/complement-record-actions";
import { ChoicePractice } from "./choice-practice";

export function ComplementPractice({
  initialQuiz,
  mode,
  canSave,
}: {
  initialQuiz: PrepositionQuestion[];
  mode: ComplementMode;
  canSave: boolean;
}) {
  return (
    <ChoicePractice
      initialQuiz={initialQuiz}
      canSave={canSave}
      compactHeading
      buildNextQuiz={() => buildComplementQuiz(mode, initialQuiz.length)}
      saveRound={(round) => saveComplementRoundAction({ ...round, mode })}
      recordsHref="/practice/complements/records"
      choiceLabel="補語を選ぶ"
    />
  );
}
