import assert from "node:assert/strict";
import { test } from "node:test";

import { diffCorrection } from "../src/presentation/presenters/correction-diff-presenter";

const join = (segments: { text: string }[]) =>
  segments.map((segment) => segment.text).join("");

test("marks a moved particle as one deletion and one insertion", () => {
  assert.deepEqual(diffCorrection("我昨天去图书馆了。", "我昨天去了图书馆。"), {
    original: [
      { kind: "equal", text: "我昨天去图书馆" },
      { kind: "delete", text: "了" },
      { kind: "equal", text: "。" },
    ],
    corrected: [
      { kind: "equal", text: "我昨天去" },
      { kind: "insert", text: "了" },
      { kind: "equal", text: "图书馆。" },
    ],
    changeCount: 2,
  });
});

test("groups adjacent deletions and insertions into one change", () => {
  const diff = diffCorrection("我已经学中文两年。", "我已经学了两年中文了。");
  assert.deepEqual(diff.original, [
    { kind: "equal", text: "我已经学" },
    { kind: "delete", text: "中文" },
    { kind: "equal", text: "两年。" },
  ]);
  assert.deepEqual(diff.corrected, [
    { kind: "equal", text: "我已经学" },
    { kind: "insert", text: "了" },
    { kind: "equal", text: "两年" },
    { kind: "insert", text: "中文了" },
    { kind: "equal", text: "。" },
  ]);
  assert.equal(diff.changeCount, 2);
});

test("folds a stray shared character into the surrounding rewrite", () => {
  // Without folding, the shared 一 splits this into buy→买 and 个new→台新.
  assert.deepEqual(
    diffCorrection("我想buy一个new电脑。", "我想买一台新电脑。"),
    {
      original: [
        { kind: "equal", text: "我想" },
        { kind: "delete", text: "buy一个new" },
        { kind: "equal", text: "电脑。" },
      ],
      corrected: [
        { kind: "equal", text: "我想" },
        { kind: "insert", text: "买一台新" },
        { kind: "equal", text: "电脑。" },
      ],
      changeCount: 1,
    },
  );
});

test("keeps short unchanged runs between single-character edits", () => {
  assert.deepEqual(diffCorrection("日记 9/26", "日记 9月26日"), {
    original: [
      { kind: "equal", text: "日记 9" },
      { kind: "delete", text: "/" },
      { kind: "equal", text: "26" },
    ],
    corrected: [
      { kind: "equal", text: "日记 9" },
      { kind: "insert", text: "月" },
      { kind: "equal", text: "26" },
      { kind: "insert", text: "日" },
    ],
    changeCount: 2,
  });
});

test("identical and fully rewritten texts", () => {
  assert.deepEqual(diffCorrection("你好。", "你好。"), {
    original: [{ kind: "equal", text: "你好。" }],
    corrected: [{ kind: "equal", text: "你好。" }],
    changeCount: 0,
  });
  assert.deepEqual(diffCorrection("甲", "乙"), {
    original: [{ kind: "delete", text: "甲" }],
    corrected: [{ kind: "insert", text: "乙" }],
    changeCount: 1,
  });
  assert.deepEqual(diffCorrection("", "乙"), {
    original: [],
    corrected: [{ kind: "insert", text: "乙" }],
    changeCount: 1,
  });
});

test("keeps surrogate pairs intact and reproduces both texts", () => {
  const original = "我喜欢𠮷野家。";
  const corrected = "我很喜欢𠮷野家！";
  const diff = diffCorrection(original, corrected);
  assert.equal(join(diff.original), original);
  assert.equal(join(diff.corrected), corrected);
  assert.ok(diff.original.some((s) => s.text.includes("𠮷")));
  assert.equal(diff.changeCount, 2);
});

test("falls back to a whole replacement for very long texts", () => {
  const original = "天".repeat(3000) + "地".repeat(3000);
  const corrected = "地".repeat(3000) + "天".repeat(3000);
  const diff = diffCorrection(original, corrected);
  assert.deepEqual(diff, {
    original: [{ kind: "delete", text: original }],
    corrected: [{ kind: "insert", text: corrected }],
    changeCount: 1,
  });
});
