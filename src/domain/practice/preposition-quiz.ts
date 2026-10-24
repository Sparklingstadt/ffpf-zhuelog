// The prepositions a question can offer as choices.
export const PREPOSITIONS = [
  "在",
  "从",
  "往",
  "离",
  "给",
  "跟",
  "对",
  "为",
  "用",
  "比",
  "被",
  "把",
  "向",
] as const;
export type Preposition = (typeof PREPOSITIONS)[number];

export type PrepositionItem = {
  noun: string;
  pinyin: string;
  // The Japanese phrase the answer translates; it picks the one preposition
  // that fits, since most nouns take several.
  meaning: string;
  answer: Preposition;
  // Prepositions that would also fit this phrase, never offered as wrong
  // choices.
  alsoFits?: readonly Preposition[];
};

export const PREPOSITION_ITEMS: readonly PrepositionItem[] = [
  {
    noun: "图书馆",
    pinyin: "túshūguǎn",
    meaning: "図書館で（勉強する）",
    answer: "在",
  },
  {
    noun: "公园",
    pinyin: "gōngyuán",
    meaning: "公園で（散歩する）",
    answer: "在",
  },
  {
    noun: "家",
    pinyin: "jiā",
    meaning: "家から（出かける）",
    answer: "从",
    alsoFits: ["离"],
  },
  {
    noun: "北京",
    pinyin: "Běijīng",
    meaning: "北京から（来た）",
    answer: "从",
    alsoFits: ["离"],
  },
  {
    noun: "学校",
    pinyin: "xuéxiào",
    meaning: "学校から（遠い）",
    answer: "离",
    alsoFits: ["从"],
  },
  {
    noun: "车站",
    pinyin: "chēzhàn",
    meaning: "駅から（近い）",
    answer: "离",
    alsoFits: ["从"],
  },
  {
    noun: "东边",
    pinyin: "dōngbian",
    meaning: "東へ（向かう）",
    answer: "往",
    alsoFits: ["向"],
  },
  {
    noun: "前",
    pinyin: "qián",
    meaning: "前へ（進む）",
    answer: "往",
    alsoFits: ["向"],
  },
  {
    noun: "妈妈",
    pinyin: "māma",
    meaning: "母に（電話をかける）",
    answer: "给",
    alsoFits: ["跟", "为"],
  },
  {
    noun: "客人",
    pinyin: "kèrén",
    meaning: "お客さんに（お茶を入れる）",
    answer: "给",
    alsoFits: ["为"],
  },
  {
    noun: "朋友",
    pinyin: "péngyou",
    meaning: "友達と（一緒に行く）",
    answer: "跟",
  },
  {
    noun: "同学",
    pinyin: "tóngxué",
    meaning: "クラスメートと（相談する）",
    answer: "跟",
  },
  {
    noun: "音乐",
    pinyin: "yīnyuè",
    meaning: "音楽に（興味がある）",
    answer: "对",
  },
  { noun: "健康", pinyin: "jiànkāng", meaning: "健康に（よい）", answer: "对" },
  {
    noun: "人民",
    pinyin: "rénmín",
    meaning: "人民のために（働く）",
    answer: "为",
    alsoFits: ["给"],
  },
  { noun: "筷子", pinyin: "kuàizi", meaning: "箸で（食べる）", answer: "用" },
  {
    noun: "中文",
    pinyin: "Zhōngwén",
    meaning: "中国語で（話す）",
    answer: "用",
  },
  { noun: "哥哥", pinyin: "gēge", meaning: "兄より（背が高い）", answer: "比" },
  {
    noun: "昨天",
    pinyin: "zuótiān",
    meaning: "昨日より（寒い）",
    answer: "比",
  },
  {
    noun: "小偷",
    pinyin: "xiǎotōu",
    meaning: "泥棒に（財布を盗まれた）",
    answer: "被",
  },
  {
    noun: "风",
    pinyin: "fēng",
    meaning: "風に（吹き飛ばされた）",
    answer: "被",
  },
  {
    noun: "作业",
    pinyin: "zuòyè",
    meaning: "宿題を（書き終えた）",
    answer: "把",
  },
  { noun: "门", pinyin: "mén", meaning: "ドアを（閉めた）", answer: "把" },
  {
    noun: "老师",
    pinyin: "lǎoshī",
    meaning: "先生に（学ぶ）",
    answer: "向",
    alsoFits: ["跟"],
  },
];

export const CHOICE_COUNT = 4;

export type PrepositionQuestion = {
  noun: string;
  pinyin: string;
  meaning: string;
  answer: Preposition;
  // CHOICE_COUNT prepositions in display order; exactly one is the answer.
  choices: Preposition[];
};

// A random number in [0, 1), as Math.random returns.
export type Random = () => number;

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function buildQuestion(
  item: PrepositionItem,
  random: Random = Math.random,
): PrepositionQuestion {
  const wrong = PREPOSITIONS.filter(
    (preposition) =>
      preposition !== item.answer && !item.alsoFits?.includes(preposition),
  );
  const choices = shuffled(
    [item.answer, ...shuffled(wrong, random).slice(0, CHOICE_COUNT - 1)],
    random,
  );
  return {
    noun: item.noun,
    pinyin: item.pinyin,
    meaning: item.meaning,
    answer: item.answer,
    choices,
  };
}

// `count` questions on different nouns, in random order.
export function buildQuiz(
  count: number,
  random: Random = Math.random,
  items: readonly PrepositionItem[] = PREPOSITION_ITEMS,
): PrepositionQuestion[] {
  return shuffled(items, random)
    .slice(0, count)
    .map((item) => buildQuestion(item, random));
}

// How far the progress bar reaches, 0 to 100.
export function progressPercent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
}
