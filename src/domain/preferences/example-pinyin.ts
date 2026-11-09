// Whether the pinyin of an example sentence shows as soon as the question is
// solved, or waits until the learner has read the sentence and asks for it.
export type ExamplePinyinPreference = "shown" | "hidden";

export function parseExamplePinyinPreference(
  value: unknown,
): ExamplePinyinPreference {
  return value === "hidden" ? "hidden" : "shown";
}
