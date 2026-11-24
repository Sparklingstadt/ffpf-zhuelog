// How a text sent to the LINE bot is routed.

// The longest text the bot takes. Counted in code points (an emoji is one).
export const LINE_TEXT_MAX_CODE_POINTS = 500;

export type LineLearningKind = "correction" | "translation";

export type LineTextRoute = LineLearningKind | "too-long" | "unsupported";

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;

// Length first; any Hiragana or Katakana means translation; otherwise any
// Han means correction.
export function classifyLineText(text: string): LineTextRoute {
  if ([...text].length > LINE_TEXT_MAX_CODE_POINTS) return "too-long";
  if (KANA.test(text)) return "translation";
  if (HAN.test(text)) return "correction";
  return "unsupported";
}
