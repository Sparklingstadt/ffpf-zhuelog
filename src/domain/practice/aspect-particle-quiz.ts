import { ASPECT_PARTICLE_USAGES } from "./aspect-particle-data";
import {
  hskLevelOf,
  inHskFilter,
  type HskBasis,
  type HskFilter,
  type HskLevel,
} from "./hsk-level";
import { examplePinyinOf } from "./preposition-quiz";
import {
  BLANK,
  type ChoiceQuestion,
  type Random,
  shuffled,
} from "./choice-question";

// The choice for a sentence whose blank takes no particle.
export const NO_PARTICLE = "なし";

// Every question offers the same four choices, so they keep this order
// instead of being shuffled.
export const ASPECT_PARTICLE_CHOICES = ["了", "过", "着", NO_PARTICLE] as const;
export type AspectParticleChoice = (typeof ASPECT_PARTICLE_CHOICES)[number];

const PINYIN: Record<AspectParticleChoice, string> = {
  了: "le",
  过: "guo",
  着: "zhe",
  [NO_PARTICLE]: "",
};

// One 了・过・着 question: a sentence with BLANK after a verb or at its end,
// the choice that goes there, and the Japanese meaning that tells the
// choices apart (読んだ／読んだことがある／読んでいる).
export type AspectParticleUsage = {
  // "aspect-NN". The record and the review queue keep it, so never reuse one.
  id: string;
  prompt: string;
  answer: AspectParticleChoice;
  translation: string;
};

export const ASPECT_PARTICLE_ID_PREFIX = "aspect-";

export const ASPECT_PARTICLE_PRACTICE = {
  label: "了・过・着",
  description:
    "動作の完了・経験・持続を表す助詞を選びます。何も入らない文もあります。例：我看（过）这本书（読んだことがある）、门开（着）（開いている）。",
} as const;

export function isAspectParticleQuestionId(id: string): boolean {
  return id.startsWith(ASPECT_PARTICLE_ID_PREFIX);
}

// The sentence of a question: the particle in the blank, or the blank left
// out when nothing goes there.
export function aspectParticleSentence(usage: AspectParticleUsage): string {
  return usage.prompt.replace(
    BLANK,
    usage.answer === NO_PARTICLE ? "" : usage.answer,
  );
}

// The HSK level of a question, decided by `basis` from its sentence.
export function aspectParticleUsageLevel(
  usage: AspectParticleUsage,
  basis: HskBasis,
): HskLevel {
  return hskLevelOf(basis, aspectParticleSentence(usage));
}

function usagesAt(filter: HskFilter | null) {
  return ASPECT_PARTICLE_USAGES.filter((usage) =>
    inHskFilter(filter, aspectParticleSentence(usage)),
  );
}

export function countAspectParticleQuestions(
  filter: HskFilter | null = null,
): number {
  return usagesAt(filter).length;
}

// One question. The sentence is the prompt, labelled by the practice as the
// complement modes label theirs.
export function aspectParticleQuestion(
  usage: AspectParticleUsage,
): ChoiceQuestion {
  const sentence = aspectParticleSentence(usage);
  return {
    id: usage.id,
    noun: ASPECT_PARTICLE_PRACTICE.label,
    meaning: usage.translation,
    prompt: usage.prompt,
    phrase: sentence,
    answer: usage.answer,
    pinyin: PINYIN[usage.answer],
    example: sentence,
    examplePinyin: examplePinyinOf(sentence),
    translation: usage.translation,
    choices: [...ASPECT_PARTICLE_CHOICES],
  };
}

// The question with this id, or null when the data no longer has it.
export function aspectParticleQuestionById(id: string): ChoiceQuestion | null {
  const usage = ASPECT_PARTICLE_USAGES.find((u) => u.id === id);
  return usage ? aspectParticleQuestion(usage) : null;
}

// `count` questions in random order, only those of the filter's level when
// one is given. Built on the server first so hydration is deterministic;
// each retry builds a new order in the browser.
export function buildAspectParticleQuiz(
  count = 25,
  random: Random = Math.random,
  filter: HskFilter | null = null,
): ChoiceQuestion[] {
  return shuffled(usagesAt(filter), random)
    .slice(0, Math.max(0, Math.floor(count)))
    .map(aspectParticleQuestion);
}
