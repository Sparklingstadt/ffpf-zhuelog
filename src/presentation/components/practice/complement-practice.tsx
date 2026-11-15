"use client";
import type { ComplementMode } from "@/domain/practice/complement-quiz";
import type { HskFilter } from "@/domain/practice/hsk-level";
import type { ChoiceQuestion } from "@/domain/practice/choice-question";
import { saveComplementRoundAction } from "@/presentation/actions/practice-record-actions";
import { ChoicePractice } from "./choice-practice";

export function ComplementPractice({
  initialQuiz,
  mode,
  canSave,
  filter,
}: {
  initialQuiz: ChoiceQuestion[];
  mode: ComplementMode;
  canSave: boolean;
  // The HSK level the questions are of and how it is decided, or null for
  // every question.
  filter: HskFilter | null;
}) {
  return (
    <ChoicePractice
      initialQuiz={initialQuiz}
      canSave={canSave}
      // The verb mode shows its verb large, as the preposition practice
      // shows its noun; the other modes' prompts are whole sentences.
      compactHeading={mode !== "verb"}
      quizKind={`complement:${mode}`}
      level={filter?.level ?? null}
      saveRound={(round) => saveComplementRoundAction({ ...round, mode })}
      recordsHref="/practice/complements/records"
      choiceLabel="補語を選ぶ"
    />
  );
}
