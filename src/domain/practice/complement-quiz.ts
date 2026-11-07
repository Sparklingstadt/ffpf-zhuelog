import { COMPLEMENT_USAGES } from "./complement-data";
import {
  buildComplementVerbQuiz,
  countComplementVerbQuestions,
} from "./complement-verb-quiz";
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
  "direction-simple": {
    label: "単純方向補語",
    description:
      "動詞＋来／去／上／下／进／出／回／过／起／开で、動作の方向を表します。例：寄来（送ってくる）、拿出（取り出す）。",
  },
  "direction-compound": {
    label: "複合方向補語",
    description:
      "動詞＋上来／下去／进来／出去などで、方向と話し手への近づき・遠ざかりを表します。例：走下来、跑出去。",
  },
  "direction-simple-extended": {
    label: "単純方向補語の派生義",
    description:
      "上／下／开／出／过／起が、方向以外の意味を表します。例：考上（合格する）、看出（見て取る）、坐过站（乗り過ごす）。",
  },
  "direction-compound-extended": {
    label: "複合方向補語の派生義",
    description:
      "起来／下去／下来／出来／过来／过去が、開始・継続・定着・識別・回復などを表します。例：笑起来、坚持下去、醒过来。",
  },
  // Built from the complement CSV like the preposition practice: a verb and
  // a meaning, the complement blanked out of a short phrase, and the wrong
  // choices picked by rule (complement-verb-quiz.ts).
  verb: {
    label: "動詞から選ぶ",
    description:
      "動詞と日本語の意味から、その動詞に付く補語を選びます。結果・方向・可能・程度のすべての補語が混ざって出ます。例：看＋読んで理解する → 懂。",
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

export function countComplementQuestions(mode: ComplementMode): number {
  if (mode === "verb") return countComplementVerbQuestions();
  return COMPLEMENT_USAGES.filter((q) => q.mode === mode).length;
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
  if (mode === "verb")
    return buildComplementVerbQuiz(Math.max(0, Math.floor(count)), random);
  return shuffled(
    COMPLEMENT_USAGES.filter((q) => q.mode === mode),
    random,
  )
    .slice(0, Math.max(0, Math.floor(count)))
    .map((q) => complementQuestion(q, random));
}

// One question of the complement data, its choices shuffled.
export function complementQuestion(
  q: ComplementUsage,
  random: Random = Math.random,
): PrepositionQuestion {
  return {
    id: q.id,
    noun: COMPLEMENT_MODES[q.mode].label,
    meaning: q.translation,
    prompt: q.prompt,
    phrase: q.prompt.replace("（　）", q.answer),
    answer: q.answer,
    pinyin: q.pinyin,
    example: q.prompt.replace("（　）", q.answer),
    translation: q.translation,
    choices: shuffled(q.choices, random),
  };
}
