// Prepositions that also work in a category none of their CSV rows is in.
// 为 also gives a cause (为这件事生气); 由 is close to 由于; the direction
// words also point at a person (朝他笑, 冲着他喊). Read by the preposition
// quiz source and by the data generator's wrong-choice check.
export const PREPOSITION_ALSO_IN: Record<string, readonly string[]> = {
  为: ["原因・条件・除外・資格"],
  由: ["原因・条件・除外・資格"],
  朝: ["相手・対象・話題・比較"],
  朝着: ["相手・対象・話題・比較"],
  向着: ["相手・対象・話題・比較"],
  对着: ["相手・対象・話題・比較"],
  当着: ["相手・対象・話題・比較"],
  冲: ["相手・対象・話題・比較"],
  冲着: ["相手・対象・話題・比較"],
};
