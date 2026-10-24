import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conversationTitle,
  fitsLimits,
  MAX_MESSAGES,
  MAX_TOTAL_CHARS,
} from "../src/domain/chat/conversation";

test("conversationTitle squeezes spaces, cuts at 80, falls back", () => {
  assert.equal(conversationTitle("  你好\n  世界 "), "你好 世界");
  assert.equal(conversationTitle("字".repeat(100)), "字".repeat(80));
  assert.equal(conversationTitle(" \n "), "新しい会話");
});

test("fitsLimits counts 40 messages and 40000 chars", () => {
  const texts = (n: number, text = "a") =>
    Array.from({ length: n }, () => ({ text }));
  assert.equal(fitsLimits(texts(MAX_MESSAGES)), true);
  assert.equal(fitsLimits(texts(MAX_MESSAGES + 1)), false);
  assert.equal(fitsLimits([{ text: "字".repeat(MAX_TOTAL_CHARS) }]), true);
  assert.equal(
    fitsLimits([{ text: "字".repeat(MAX_TOTAL_CHARS) }, { text: "a" }]),
    false,
  );
  // Characters, not UTF-16 units: an astral character counts once.
  assert.equal(fitsLimits([{ text: "𠀋".repeat(MAX_TOTAL_CHARS) }]), true);
});
