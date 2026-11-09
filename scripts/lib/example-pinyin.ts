// Turns a practice example sentence into tone-marked pinyin, one syllable per
// word gap: "我已经看完这本书了。" → "Wǒ yǐ jīng kàn wán zhè běn shū le."
// Used only by scripts/generate-example-pinyin.ts, so pinyin-pro stays out of
// the app.
import { pinyin } from "pinyin-pro";

// pinyin-pro reads some characters wrongly in these sentences. Each entry is
// a word as it appears in a sentence and the readings of its characters, with
// "*" keeping pinyin-pro's own reading. Longer words are applied last, so
// they win over the shorter ones they contain.
export const READING_FIXES: Readonly<Record<string, string>> = {
  // 儿 that is a syllable of its own, not the erhua r.
  儿子: "ér *",
  女儿: "* ér",
  儿童: "ér *",
  // 得 is the structural de unless a word below says otherwise.
  得意: "dé *",
  不得了: "* dé liǎo",
  赢得: "* dé",
  得去: "děi *",
  得分开: "děi * *",
  // 了 after the potential 得 is liǎo; "查出了" is the aspect le.
  办得了: "* * liǎo",
  决得了: "* * liǎo",
  去得了: "* * liǎo",
  查出了: "* * le",
  // 着 in a potential complement is zháo, as in 睡着.
  睡不着: "* * zháo",
  睡得着: "* * zháo",
  够不着: "* * zháo",
  够得着: "* * zháo",
  睡不着觉: "* * zháo jiào",
  // 过 after a verb, marking an experience, is guo (the 了・过・着 practice).
  // The following character keeps these off the directional 过 (走过来).
  去过两: "* guo *",
  吃过北: "* guo *",
  见过这: "* guo *",
  学过钢: "* guo *",
  见过面: "* guo *",
  看过两: "* guo *",
  听说过: "* * guo",
  作过三: "* guo *",
  爬过富: "* guo *",
  他提过: "* * guo",
  坐过飞: "* guo *",
  前做过: "* * guo",
  // 地 marking an adverbial is de.
  悄悄地: "* * de",
  慢慢地: "* * de",
  深深地: "* * de",
  轻轻地: "* * de",
  生气地: "* * de",
  耐心地: "* * de",
  长得: "zhǎng *",
  长胖: "zhǎng *",
  教了: "jiāo *",
  倒进: "dào *",
  倒满: "dào *",
  别再倒: "* * dào",
  只剩: "zhǐ *",
  不用还: "* * huán",
  伞还: "* huán",
  还赶得上: "hái * * *",
  钻出: "zuān *",
  钻进: "zuān *",
  钻不进: "zuān * *",
  累得腿: "lèi * *",
  文件夹: "* * jiā",
  切开: "qiē *",
  应依: "yīng *",
  卡住: "qiǎ *",
  扎了起来: "zā * * *",
  很多血: "* * xiě",
  奔车站: "bèn * *",
  系上: "jì *",
  划破: "huá *",
  病了一场: "* * * cháng",
  这场大病: "* cháng * *",
  场大地震: "cháng * * *",
};

const PUNCTUATION: Readonly<Record<string, string>> = {
  "。": ".",
  "，": ",",
  "、": ",",
  "？": "?",
  "！": "!",
  "：": ":",
  "；": ";",
  "…": "…",
  "（": "(",
  "）": ")",
};
// Marks that open, and so attach to the syllable after them.
const OPENING = new Set(["“", "‘", "("]);
const CLOSING = new Set(["”", "’"]);
const HAN = /^\p{Script=Han}$/u;
// The reading READING_FIXES and the rules give an erhua 儿.
const ERHUA = "r";

function fixReadings(sentence: string, syllables: string[]): string[] {
  const chars = [...sentence];
  const fixed = [...syllables];
  const words = Object.keys(READING_FIXES).sort(
    (a, b) => [...a].length - [...b].length,
  );
  for (const word of words) {
    const readings = READING_FIXES[word].split(" ");
    const length = [...word].length;
    if (readings.length !== length)
      throw new Error(
        `${word}: ${length} characters, ${readings.length} readings`,
      );
    for (let i = 0; i + length <= chars.length; i++) {
      if (chars.slice(i, i + length).join("") !== word) continue;
      readings.forEach((reading, k) => {
        if (reading !== "*") fixed[i + k] = reading;
      });
    }
  }
  return fixed;
}

export function examplePinyin(sentence: string): string {
  const chars = [...sentence];
  const syllables = pinyin(sentence, { type: "array" });
  if (syllables.length !== chars.length)
    throw new Error(
      `${sentence}: pinyin-pro did not give one item per character`,
    );
  // The structural 得 (跑得快, 听得懂) is far more common here than dé/děi,
  // and 子 is the noun suffix zi (箱子, 肚子); pinyin-pro often reads zǐ.
  // Words that need dé, děi or zǐ go in READING_FIXES.
  // 儿 after a syllable is the erhua r, written onto it (一点儿 → yì diǎnr).
  const base = syllables.map((syllable, i) =>
    chars[i] === "得"
      ? "de"
      : chars[i] === "子"
        ? "zi"
        : chars[i] === "儿" && i > 0 && HAN.test(chars[i - 1])
          ? ERHUA
          : syllable,
  );
  const readings = fixReadings(sentence, base);

  let out = "";
  let attach = true; // No space before the first syllable or after an opening mark.
  readings.forEach((reading, i) => {
    const char = chars[i];
    if (reading === ERHUA) {
      out += "r";
      return;
    }
    if (HAN.test(char)) {
      out += (attach ? "" : " ") + reading;
      attach = false;
      return;
    }
    const mark = PUNCTUATION[char];
    if (mark === undefined && !OPENING.has(char) && !CLOSING.has(char))
      throw new Error(`${sentence}: no rule for ${JSON.stringify(char)}`);
    if (OPENING.has(char) || OPENING.has(mark)) {
      out += (out ? " " : "") + (mark ?? char);
      attach = true;
    } else {
      // Closing marks stick to the syllable before them.
      out += mark ?? char;
      attach = false;
    }
  });
  return out.charAt(0).toUpperCase() + out.slice(1);
}
