import assert from "node:assert/strict";
import { test } from "node:test";

import { formatGenerationFailure } from "@ffpf-zhuelog/core/domain/line/generation-failure";
import { makeLineLearningResult } from "@ffpf-zhuelog/core/domain/line/line-learning";

const translation = {
  translatedText: "今天很忙。",
  pinyin: "Jīntiān hěn máng.",
  hints: ["忙しい=忙"],
};

test("translation results become translation drafts", () => {
  const { draft } = makeLineLearningResult(
    "translation",
    "今日は忙しい。",
    translation,
  );
  assert.deepEqual(draft, {
    originalText: "今日は忙しい。",
    correctedText: "今天很忙。",
    pinyin: "Jīntiān hěn máng.",
    hints: ["忙しい=忙"],
    kind: "translation",
  });
});

test("correction results keep the correction kind", () => {
  const { draft } = makeLineLearningResult("correction", "我很忙吗", {
    correctedText: "我很忙。",
    pinyin: "Wǒ hěn máng.",
    hints: ["文末は句点"],
  });
  assert.equal(draft.kind, "correction");
  assert.equal(draft.correctedText, "我很忙。");
});

test("blank or unexpected generator output is rejected", () => {
  for (const output of [
    { ...translation, translatedText: "   " },
    { ...translation, extra: "不要" },
    { ...translation, hints: [] },
  ])
    assert.throws(() =>
      makeLineLearningResult("translation", "今日は忙しい。", output),
    );
});

test("results too long for LINE are rejected with CSV_TOO_LONG", () => {
  assert.throws(
    () =>
      // Quotes are doubled in the CSV, so they inflate it the most.
      makeLineLearningResult("translation", '"'.repeat(500), {
        translatedText: '"'.repeat(1000),
        pinyin: '"'.repeat(1600),
        hints: ["ヒント"],
      }),
    { message: "CSV_TOO_LONG" },
  );
});

test("failure replies name the action and the code", () => {
  const timeout = formatGenerationFailure("OPENAI_TIMEOUT", "translation");
  assert.ok(timeout.startsWith("翻訳できませんでした。"));
  assert.ok(timeout.includes("エラーコード: OPENAI_TIMEOUT"));
  assert.ok(
    formatGenerationFailure("OPENAI_RATE_LIMITED", "correction").startsWith(
      "添削できませんでした。",
    ),
  );
  assert.ok(
    formatGenerationFailure("CORRECTION_TOO_LONG", "translation").includes(
      "文を短く分けて送信してください。",
    ),
  );
});
