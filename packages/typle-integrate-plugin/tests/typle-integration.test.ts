import assert from "node:assert/strict";
import { test } from "node:test";

import type { LearningEntry } from "@ffpf-zhuelog/core/integration";
import typle from "@ffpf-zhuelog/typle-integrate-plugin";

function entry(overrides: Partial<LearningEntry> = {}): LearningEntry {
  return {
    id: "entry-1",
    originalText: "这个菜很好吃。",
    correctedText: "这道菜很好吃。",
    pinyin: "Zhè dào cài hěn hǎochī.",
    createdAt: new Date("2026-09-25T00:00:00.000Z"),
    hints: [{ id: "hint-1", content: "料理を数える量詞は「道」", position: 0 }],
    ...overrides,
  };
}

test("Typle integration keeps the existing id and screen copy", () => {
  assert.equal(typle.id, "typle");
  assert.deepEqual(typle.text, {
    navLabel: "Typle用リスト",
    title: "Typle用の復習リスト",
    description:
      "添削で増えた中国語と、ヒント内で引用された語を集めて、Typleの保存形式へ整えます。",
    listTitle: "自動生成された単語リスト",
    listDescription:
      "表示文字と入力文字には中国語を、補足には元のヒント・例文・拼音を入れます。同じ語は1件にまとめます。",
    sources: ["ヒントの「引用語」", "添削で追加された語"],
    emptyMessage:
      "抽出できる語がまだありません。ヒントに中国語を「」で記録するか、添削を追加してください。",
    downloadLabel: "Typle互換JSONをダウンロード",
  });
});

test("preview lists extracted words with their annotations", () => {
  const preview = typle.preview([entry()]);
  assert.deepEqual(preview.stats, [
    { label: "抽出した復習語", value: "1語" },
    { label: "Typleでの入力", value: "中国語IME" },
  ]);
  assert.equal(preview.items.length, 1);
  assert.equal(preview.items[0].title, "道");
  assert.equal(preview.items[0].lang, "zh-Hans");
  assert.match(preview.items[0].description, /料理を数える量詞/);
  assert.match(preview.items[0].description, /拼音: Zhè dào cài/);
});

test("export returns null when no Typle words can be extracted", () => {
  const plain = entry({
    originalText: "我很好。",
    correctedText: "我很好。",
    hints: [],
  });
  assert.deepEqual(typle.preview([plain]).items, []);
  assert.equal(typle.export([plain]), null);
});

test("export produces the typle-r v1 JSON download", () => {
  const file = typle.export([entry()]);
  assert.ok(file);
  assert.equal(file.fileName, "ffpf-zhuelog-typle-words.json");
  assert.equal(file.contentType, "application/json; charset=utf-8");
  const payload = JSON.parse(file.body);
  assert.equal(payload.version, 1);
  assert.equal(payload.lists[0].id, "ffpf-zhuelog-review");
  assert.deepEqual(
    payload.lists[0].words.map((word: { display: string }) => word.display),
    ["道"],
  );
  assert.equal(file.body, JSON.stringify(payload, null, 2));
});
