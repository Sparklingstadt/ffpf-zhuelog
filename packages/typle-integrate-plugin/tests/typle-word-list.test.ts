import assert from "node:assert/strict";
import { test } from "node:test";

import type { LearningEntry } from "@ffpf-zhuelog/core/integration";
import { createTypleExport, extractTypleWords } from "../src/typle-word-list";

function entry(overrides: Partial<LearningEntry> = {}): LearningEntry {
  return {
    id: "entry-1",
    kind: "correction",
    originalText: "这个菜很好吃。",
    correctedText: "这道菜很好吃。",
    pinyin: "Zhè dào cài hěn hǎochī.",
    createdAt: new Date("2026-09-25T00:00:00.000Z"),
    hints: [{ id: "hint-1", content: "料理を数える量詞は「道」", position: 0 }],
    ...overrides,
  };
}

test("extracts quoted hint terms and corrected Chinese words for Typle", () => {
  const words = extractTypleWords([entry()]);
  assert.deepEqual(
    words.map((word) => word.display),
    ["道"],
  );
  assert.equal(words[0].input, "道");
  assert.match(words[0].annotation, /料理を数える量詞/);
  assert.match(words[0].annotation, /Zhè dào cài/);
});

test("deduplicates terms newest-first and accepts a short all-Han hint", () => {
  const words = extractTypleWords([
    entry(),
    entry({
      id: "entry-2",
      originalText: "我去学校。",
      correctedText: "我去了学校。",
      pinyin: "Wǒ qù le xuéxiào.",
      hints: [
        { id: "hint-2", content: "了", position: 0 },
        { id: "hint-3", content: "動作の完了を示す「了」", position: 1 },
      ],
    }),
  ]);
  assert.deepEqual(
    words.map((word) => word.display),
    ["道", "了"],
  );
});

test("keeps only the added word when a correction moves text", () => {
  const words = extractTypleWords([
    entry({
      originalText: "我昨天去图书馆了。",
      correctedText: "我昨天去了图书馆。",
      pinyin: "Wǒ zuótiān qù le túshūguǎn.",
      hints: [],
    }),
  ]);
  assert.deepEqual(
    words.map((word) => word.display),
    ["了"],
  );
});

test("keeps three-character words whole instead of ICU fragments", () => {
  const words = extractTypleWords([
    entry({
      originalText: "我去书店。",
      correctedText: "我去图书馆。",
      pinyin: "Wǒ qù túshūguǎn.",
      hints: [{ id: "hint-1", content: "「博物馆」も同じ形", position: 0 }],
    }),
  ]);
  assert.deepEqual(
    words.map((word) => word.display),
    ["博物馆", "图书馆"],
  );
});

test("still segments longer corrected spans into words", () => {
  const words = extractTypleWords([
    entry({
      originalText: "我吃饭了。",
      correctedText: "我已经吃过饭了。",
      pinyin: "Wǒ yǐjīng chīguo fàn le.",
      hints: [],
    }),
  ]);
  assert.deepEqual(
    words.map((word) => word.display),
    ["已经", "吃", "过"],
  );
});

test("creates the v1 saved-list shape accepted by typle-r", () => {
  const payload = createTypleExport(
    [entry()],
    new Date("2026-09-25T01:02:03.000Z"),
  );
  assert.equal(payload.version, 1);
  assert.equal(payload.lists[0].id, "ffpf-zhuelog-review");
  assert.equal(payload.lists[0].name, "学习録から復習");
  assert.deepEqual(payload.lists[0].records, []);
  assert.equal(payload.lists[0].createdAt, "2026-09-25T01:02:03.000Z");
});

test("takes only hint terms found in the translation from translation notes", () => {
  const words = extractTypleWords([
    entry({
      kind: "translation",
      originalText: "今日は忙しいです。",
      correctedText: "今天我很忙。",
      pinyin: "Jīntiān wǒ hěn máng.",
      hints: [
        { id: "hint-1", content: "「忙しい」は「忙」で表します", position: 0 },
      ],
    }),
    entry({
      id: "entry-2",
      kind: "translation",
      originalText: "手紙を書きました。",
      correctedText: "我写了信。",
      pinyin: "Wǒ xiě le xìn.",
      hints: [
        { id: "hint-2", content: "「手紙」は中国語で「信」です", position: 0 },
      ],
    }),
  ]);
  assert.deepEqual(
    words.map((word) => word.display),
    ["忙", "信"],
  );
});
