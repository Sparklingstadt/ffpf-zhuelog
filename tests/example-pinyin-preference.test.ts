import assert from "node:assert/strict";
import { test } from "node:test";

import { parseExamplePinyinPreference } from "../src/domain/preferences/example-pinyin";
import {
  EXAMPLE_PINYIN_STORAGE_KEY,
  getExamplePinyinSnapshot,
  getServerExamplePinyinSnapshot,
  setExamplePinyinPreference,
  subscribeToExamplePinyin,
} from "../src/infrastructure/preferences/example-pinyin-store";

class FakeStorage {
  items = new Map<string, string>();
  blocked = false;
  getItem(key: string) {
    if (this.blocked) throw new Error("blocked");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.blocked) throw new Error("blocked");
    this.items.set(key, value);
  }
  removeItem(key: string) {
    if (this.blocked) throw new Error("blocked");
    this.items.delete(key);
  }
}

const storage = new FakeStorage();
const events = new EventTarget();
Object.assign(globalThis, {
  localStorage: storage,
  window: {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  },
});

test("only 'hidden' hides; anything else shows the pinyin", () => {
  for (const value of [undefined, null, "", "shown", "Hidden", 1, {}])
    assert.equal(parseExamplePinyinPreference(value), "shown");
  assert.equal(parseExamplePinyinPreference("hidden"), "hidden");
  assert.equal(getServerExamplePinyinSnapshot(), "shown");
});

test("the choice is stored on the device and announced to subscribers", () => {
  let changes = 0;
  const stop = subscribeToExamplePinyin(() => changes++);

  assert.equal(getExamplePinyinSnapshot(), "shown");
  assert.equal(setExamplePinyinPreference("hidden"), true);
  assert.equal(storage.items.get(EXAMPLE_PINYIN_STORAGE_KEY), "hidden");
  assert.equal(getExamplePinyinSnapshot(), "hidden");

  assert.equal(setExamplePinyinPreference("shown"), true);
  assert.equal(storage.items.has(EXAMPLE_PINYIN_STORAGE_KEY), false);
  assert.equal(getExamplePinyinSnapshot(), "shown");
  assert.equal(changes, 2);

  stop();
  setExamplePinyinPreference("hidden");
  assert.equal(changes, 2);
  setExamplePinyinPreference("shown");
});

test("blocked storage keeps the choice for this page only", () => {
  storage.blocked = true;
  try {
    assert.equal(getExamplePinyinSnapshot(), "shown");
    assert.equal(setExamplePinyinPreference("hidden"), false);
    assert.equal(getExamplePinyinSnapshot(), "hidden");
  } finally {
    storage.blocked = false;
  }
  assert.equal(setExamplePinyinPreference("shown"), true);
  assert.equal(getExamplePinyinSnapshot(), "shown");
});
