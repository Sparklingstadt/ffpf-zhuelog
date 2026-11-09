"use client";
import type { HskFilter } from "@/domain/practice/hsk-level";
import { buildMeasureWordQuiz } from "@/domain/practice/measure-word-quiz";
import type { PrepositionQuestion } from "@/domain/practice/preposition-quiz";
import { saveComplementRoundAction } from "@/presentation/actions/complement-record-actions";
import { ChoicePractice } from "./choice-practice";

// The measure-word practice. Its rounds are saved with the complements' as
// mode "measure", so they share the records page and the review queue.
export function MeasureWordPractice({
  initialQuiz,
  canSave,
  filter,
}: {
  initialQuiz: PrepositionQuestion[];
  canSave: boolean;
  // The HSK level the questions are of and how it is decided, or null for
  // every question.
  filter: HskFilter | null;
}) {
  return (
    <ChoicePractice
      initialQuiz={initialQuiz}
      canSave={canSave}
      buildNextQuiz={() =>
        buildMeasureWordQuiz(initialQuiz.length, Math.random, filter)
      }
      saveRound={(round) =>
        saveComplementRoundAction({ ...round, mode: "measure" })
      }
      recordsHref="/practice/complements/records"
      choiceLabel="量詞を選ぶ"
    />
  );
}
