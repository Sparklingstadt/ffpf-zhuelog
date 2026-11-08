"use client";
import { buildMeasureWordQuiz } from "@/domain/practice/measure-word-quiz";
import type { PrepositionQuestion } from "@/domain/practice/preposition-quiz";
import { saveComplementRoundAction } from "@/presentation/actions/complement-record-actions";
import { ChoicePractice } from "./choice-practice";

// The measure-word practice. Its rounds are saved with the complements' as
// mode "measure", so they share the records page and the review queue.
export function MeasureWordPractice({
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
      buildNextQuiz={() => buildMeasureWordQuiz(initialQuiz.length)}
      saveRound={(round) =>
        saveComplementRoundAction({ ...round, mode: "measure" })
      }
      recordsHref="/practice/complements/records"
      choiceLabel="量詞を選ぶ"
    />
  );
}
