"use client";
import type { HskFilter } from "@/domain/practice/hsk-level";
import type { ChoiceQuestion } from "@/domain/practice/choice-question";
import { saveComplementRoundAction } from "@/presentation/actions/complement-record-actions";
import { ChoicePractice } from "./choice-practice";

// The 了・过・着 practice. Its prompts are whole sentences, shown small as
// the complement modes show theirs, and its rounds are saved with the
// complements' as mode "aspect", so they share the records page and the
// review queue.
export function AspectParticlePractice({
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
      compactHeading
      quizKind="aspect-particle"
      level={filter?.level ?? null}
      saveRound={(round) =>
        saveComplementRoundAction({ ...round, mode: "aspect" })
      }
      recordsHref="/practice/complements/records"
      choiceLabel="了・过・着を選ぶ"
    />
  );
}
