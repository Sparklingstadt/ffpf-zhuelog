import { COMPLEMENT_USAGES } from "./complement-data";
import type { PrepositionQuestion, Random } from "./preposition-quiz";

export const COMPLEMENT_MODES = {
  result: {
    label: "結果補語",
    description:
      "動作の結果を表します。例：听懂（聞いて理解する）、做完（やり終える）。",
  },
  potential: {
    label: "可能補語",
    description:
      "動詞＋得／不＋補語で、結果を実現できるかを表します。例：听得懂／听不懂。",
  },
  degree: {
    label: "程度補語",
    description:
      "動詞・形容詞＋得＋補語で、程度や様子を説明します。例：说得很流利、累得不想说话。",
  },
} as const;
export type ComplementMode = keyof typeof COMPLEMENT_MODES;
export type ComplementUsage = {
  id: string;
  mode: ComplementMode;
  prompt: string;
  answer: string;
  choices: readonly string[];
  translation: string;
  pinyin: string;
};

export function isComplementMode(value: string): value is ComplementMode {
  return Object.hasOwn(COMPLEMENT_MODES, value);
}

function shuffled<T>(values: readonly T[], random: Random): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Construct on the server initially to keep hydration deterministic. Each retry
// creates a new order and choice positions in the browser.
export function buildComplementQuiz(
  mode: ComplementMode,
  count = 25,
  random: Random = Math.random,
): PrepositionQuestion[] {
  return shuffled(
    COMPLEMENT_USAGES.filter((q) => q.mode === mode),
    random,
  )
    .slice(0, Math.max(0, Math.floor(count)))
    .map((q) => ({
      id: q.id,
      noun: COMPLEMENT_MODES[mode].label,
      meaning: q.translation,
      prompt: q.prompt,
      phrase: q.prompt.replace("（　）", q.answer),
      answer: q.answer,
      pinyin: q.pinyin,
      example: q.prompt.replace("（　）", q.answer),
      translation: q.translation,
      choices: shuffled(q.choices, random),
    }));
}
