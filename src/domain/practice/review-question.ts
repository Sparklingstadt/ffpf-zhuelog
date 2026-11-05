import { COMPLEMENT_USAGES } from "./complement-data";
import { complementQuestion } from "./complement-quiz";
import { PREPOSITION_USAGES } from "./preposition-data";
import {
  buildQuestion,
  type PrepositionQuestion,
  type Random,
} from "./preposition-quiz";

// The practice question a review item names, with its choices shuffled:
// "preposition" items are "<use id>:<noun>", "complement" items are the
// question's id. Null when the data no longer has it (a use or a phrase
// removed from the CSV), or for a kind the web does not know yet.
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
    const q = COMPLEMENT_USAGES.find((u) => u.id === targetId);
    return q ? complementQuestion(q, random) : null;
  }
  return null;
}
