import { COMPLEMENT_USAGES } from "./complement-data";
import type { PracticeKind, QuizSource } from "./practice-quiz";
import { PREPOSITION_ALSO_IN } from "./preposition-also-in";
import { PREPOSITION_USAGES } from "./preposition-data";

// Everything that differs between the kinds of practice: the words, the
// paths and the copy. The pages, the components and the record gateway read
// it; the quiz itself does not know which kind it serves.
export type PracticeKindConfig = {
  kind: PracticeKind;
  slug: "prepositions" | "complements";
  path: `/practice/${string}`;
  recordsPath: `/practice/${string}/records`;
  apiPath: "/v1/preposition-records" | "/v1/complement-records";
  title: string;
  eyebrow: string;
  recordsEyebrow: string;
  recordEyebrow: string;
  description: string;
  // The word to pick, as the copy names it (介詞を選ぶ, ミスした介詞).
  wordLabel: string;
  navLabel: string;
  questionCount: number;
  source: QuizSource;
};

export const PRACTICE_KINDS: Readonly<
  Record<PracticeKind, PracticeKindConfig>
> = {
  preposition: {
    kind: "preposition",
    slug: "prepositions",
    path: "/practice/prepositions",
    recordsPath: "/practice/prepositions/records",
    apiPath: "/v1/preposition-records",
    title: "介詞の練習",
    eyebrow: "Preposition practice",
    recordsEyebrow: "Preposition records",
    recordEyebrow: "Preposition record",
    description: "名詞と日本語の意味に合う介詞を、4つの中から選んでください。",
    wordLabel: "介詞",
    navLabel: "介詞練習",
    questionCount: 25,
    source: { usages: PREPOSITION_USAGES, alsoIn: PREPOSITION_ALSO_IN },
  },
  complement: {
    kind: "complement",
    slug: "complements",
    path: "/practice/complements",
    recordsPath: "/practice/complements/records",
    apiPath: "/v1/complement-records",
    title: "補語の練習",
    eyebrow: "Complement practice",
    recordsEyebrow: "Complement records",
    recordEyebrow: "Complement record",
    description: "動詞と日本語の意味に合う補語を、4つの中から選んでください。",
    wordLabel: "補語",
    navLabel: "補語練習",
    questionCount: 25,
    source: { usages: COMPLEMENT_USAGES },
  },
};

// In the order the header shows them.
export const PRACTICE_KIND_LIST: readonly PracticeKindConfig[] = [
  PRACTICE_KINDS.preposition,
  PRACTICE_KINDS.complement,
];

// The kind behind a URL segment (/practice/<slug>), or null for any other.
export function kindFromSlug(slug: string): PracticeKind | null {
  return PRACTICE_KIND_LIST.find((c) => c.slug === slug)?.kind ?? null;
}
