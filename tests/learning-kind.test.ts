import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningEntry } from "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";
import { CsvParseLearningParser } from "../src/infrastructure/csv/csv-parse-learning-parser";
import { toLearningEntry } from "../src/infrastructure/persistence/prisma/mappers/learning-entry-mapper";
import { LearningEntryCard } from "../src/presentation/components/learning/learning-entry-card";

const record = {
  id: "entry-1",
  kind: "correction",
  originalText: "我去学校。",
  correctedText: "我去了学校。",
  pinyin: "Wǒ qù le xuéxiào.",
  createdAt: new Date("2026-10-05T00:00:00.000Z"),
  sharedAt: null,
  hints: [{ id: "hint-1", content: "「了」で完了を表す", position: 0 }],
};

test("the stored kind is carried onto the learning entry", () => {
  assert.equal(toLearningEntry(record).kind, "correction");
  assert.equal(
    toLearningEntry({ ...record, kind: "translation" }).kind,
    "translation",
  );
});

test("an unknown stored kind is rejected", () => {
  assert.throws(() => toLearningEntry({ ...record, kind: "summary" }));
});

test("imported CSV rows leave the kind to the database default", () => {
  const drafts = new CsvParseLearningParser().parse(
    "最初の文,添削後の文,ピン音,ヒント\n我去学校。,我去了学校。,Wǒ qù le xuéxiào.,ヒント",
  );
  assert.equal(drafts.length, 1);
  assert.ok(!("kind" in drafts[0]));
});

function render(entry: LearningEntry) {
  return renderToStaticMarkup(
    createElement(LearningEntryCard, { entry, numberLabel: "#1" }),
  );
}

test("a correction note keeps its diff layout", () => {
  const html = render(toLearningEntry(record));
  assert.match(html, /箇所を添削/);
  assert.match(html, /<ins/);
  assert.doesNotMatch(html, /中国語訳/);
});

test("a translation note shows Japanese and Chinese without a diff", () => {
  const html = render(
    toLearningEntry({
      ...record,
      kind: "translation",
      originalText: "今日は忙しいです。",
      correctedText: "我今天很忙。",
      pinyin: "Wǒ jīntiān hěn máng.",
      hints: [],
    }),
  );
  assert.match(html, /翻訳/);
  assert.match(html, /日本語/);
  assert.match(html, /中国語訳/);
  assert.match(html, /今日は忙しいです。/);
  assert.match(html, /我今天很忙。/);
  assert.match(html, /Wǒ jīntiān hěn máng\./);
  assert.doesNotMatch(html, /箇所を添削/);
  assert.doesNotMatch(html, /添削なし/);
  assert.doesNotMatch(html, /<del|<ins/);
});
