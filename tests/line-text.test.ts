import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LINE_TEXT_MAX_CODE_POINTS,
  classifyLineText,
} from "../src/domain/line/line-text";

test("the route is Go's Classify", () => {
  assert.equal(LINE_TEXT_MAX_CODE_POINTS, 500);
  assert.equal(classifyLineText("我喜欢学习"), "correction");
  assert.equal(classifyLineText("今日は雨"), "translation");
  assert.equal(classifyLineText("カタカナ"), "translation");
  assert.equal(classifyLineText("漢字カナ"), "translation");
  assert.equal(classifyLineText("hello"), "unsupported");
  assert.equal(classifyLineText(""), "unsupported");
  assert.equal(classifyLineText("123 !?"), "unsupported");
  const atLimit = "漢".repeat(499) + "😀";
  assert.equal(classifyLineText(atLimit), "correction");
  assert.equal(classifyLineText(atLimit + "字"), "too-long");
  assert.equal(classifyLineText("a".repeat(501)), "too-long");
  assert.equal(classifyLineText("あ".repeat(501)), "too-long");
});
