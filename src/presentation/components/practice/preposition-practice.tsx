"use client";
import type { HskFilter } from "@/domain/practice/hsk-level";
import type { ChoiceQuestion } from "@/domain/practice/choice-question";
import { savePrepositionRoundAction } from "@/presentation/actions/practice-record-actions";
import { ChoicePractice } from "./choice-practice";

export function PrepositionPractice({
  initialQuiz,
  canSave,
  filter,
}: {
  initialQuiz: ChoiceQuestion[];
  canSave: boolean;
  // The HSK level the questions are of and how it is decided, or null for
  // every question.
  filter: HskFilter | null;
}) {
  return (
    <ChoicePractice
      initialQuiz={initialQuiz}
      canSave={canSave}
      quizKind="preposition"
      level={filter?.level ?? null}
      saveRound={savePrepositionRoundAction}
      recordsHref="/practice/prepositions/records"
      choiceLabel="介詞を選ぶ"
    />
  );
}
