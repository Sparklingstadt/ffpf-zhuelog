import { COMPLEMENT_USAGES } from "./complement-data";
import { complementQuestion } from "./complement-quiz";
import {
  complementVerbQuestionById,
  isVerbQuestionId,
} from "./complement-verb-quiz";
import {
  isMeasureWordQuestionId,
  measureWordQuestionById,
} from "./measure-word-quiz";
import { PREPOSITION_USAGES } from "./preposition-data";
import {
  buildQuestion,
  type PrepositionQuestion,
  type Random,
} from "./preposition-quiz";

// The practice question a review item names, with its choices shuffled:
// "preposition" items are "<use id>:<noun>", "complement" items are the
// question's id ("verb:<use id>:<verb>" for the verb mode, "measure-NN" for
// the measure-word practice, whose rounds are kept with the complements'). Null when the
// data no longer has it (a use or a phrase removed from the CSV), or for a
// kind the web does not know yet.
export function reviewQuestion(
  kind: string,
  targetId: string,
  random: Random = Math.random,
): PrepositionQuestion | null {
  if (kind === "preposition") {
    const at = targetId.indexOf(":");
    if (at <= 0) return null;
    const id = targetId.slice(0, at);
    const noun = targetId.slice(at + 1);
    const usage = PREPOSITION_USAGES.find((u) => u.id === id);
    const pair = usage?.pairs.find((p) => p.noun === noun);
    return usage && pair ? buildQuestion(usage, pair, random) : null;
  }
  if (kind === "complement") {
    // The measure-word practice keeps its rounds with the complements'.
    if (isMeasureWordQuestionId(targetId))
      return measureWordQuestionById(targetId, random);
    if (isVerbQuestionId(targetId))
      return complementVerbQuestionById(targetId, random);
    const q = COMPLEMENT_USAGES.find((u) => u.id === targetId);
    return q ? complementQuestion(q, random) : null;
  }
  return null;
}

// What the review page shows for a choice item: the question, the badge
// above it, and whether the headword is shown small. Prepositions and the
// verb mode of the complements show their noun or verb large, as their
// practice does; the other complement modes' prompts are whole sentences
// labelled by their mode.
export function reviewChoice(
  kind: string,
  targetId: string,
  random: Random = Math.random,
): { question: PrepositionQuestion; label: string; compact: boolean } | null {
  const question = reviewQuestion(kind, targetId, random);
  if (!question) return null;
  if (kind === "preposition")
    return { question, label: "介詞", compact: false };
  if (isMeasureWordQuestionId(targetId))
    return { question, label: "量詞", compact: false };
  if (isVerbQuestionId(targetId))
    return { question, label: "補語", compact: false };
  return { question, label: question.noun, compact: true };
}
