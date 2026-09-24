import test from "node:test";
import assert from "node:assert/strict";
import { formatLineLearningReply } from "../src/infrastructure/line/line-reply-formatter";
import { makeLineLearningResult } from "../src/domain/line/line-learning";
import { CsvParseLearningParser } from "../src/infrastructure/csv/csv-parse-learning-parser";

test("issue 11 pairs each corrected sentence with its pinyin while leaving stored CSV untouched", () => {
  const original = "我喜欢学习Chinese\n我am日本人";
  const { csv, draft } = makeLineLearningResult(original, {
    correctedText: "我喜欢学习汉语。我是个日本人。",
    pinyin: "Wǒ xǐhuān xuéxí Hànyǔ. Wǒ shì ge Rìběnrén.",
    hints: ["汉语=中国語", "日本人=Rìběnrén"],
  });
  assert.equal(
    formatLineLearningReply(csv),
    [
      `【元の文】\n${original}`,
      "【添削後】\n我喜欢学习汉语。\nWǒ xǐhuān xuéxí Hànyǔ.\n我是个日本人。\nWǒ shì ge Rìběnrén.",
      "【ヒント】\n1. 汉语=中国語\n2. 日本人=Rìběnrén",
    ].join("\n\n"),
  );
  assert.deepEqual(new CsvParseLearningParser().parse(csv), [draft]);
  assert.equal(formatLineLearningReply(csv), formatLineLearningReply(csv));
});

for (const [name, chinese, pinyin, expected] of [
  [
    "newlines",
    "你好\r\n再见",
    "Nǐ hǎo\r\nZàijiàn",
    "你好\nNǐ hǎo\n再见\nZàijiàn",
  ],
  [
    "quotes and repeated punctuation",
    "他说：“你好！”再见。",
    "Tā shuō: “Nǐ hǎo!” Zàijiàn.",
    "他说：“你好！”\nTā shuō: “Nǐ hǎo!”\n再见。\nZàijiàn.",
  ],
  [
    "decimal",
    "价格是3.5元。好吗？",
    "Jiàgé shì 3.5 yuán. Hǎo ma?",
    "价格是3.5元。\nJiàgé shì 3.5 yuán.\n好吗？\nHǎo ma?",
  ],
  [
    "mismatched counts",
    "你好。再见。",
    "Nǐ hǎo, zàijiàn.",
    "你好。再见。\nNǐ hǎo, zàijiàn.",
  ],
  ["more pinyin sentences", "你好。", "Nǐ. Hǎo.", "你好。\nNǐ. Hǎo."],
] as const)
  test(`LINE sentence layout: ${name}`, () => {
    const { csv } = makeLineLearningResult("原文", {
      correctedText: chinese,
      pinyin,
      hints: ["ヒント"],
    });
    assert.ok(
      formatLineLearningReply(csv).includes(
        `【添削後】\n${expected}\n\n【ヒント】`,
      ),
    );
  });
