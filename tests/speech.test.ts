import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isChineseVoice,
  nextRate,
  pickChineseVoice,
  REPLAY_WINDOW_MS,
  SLOW_RATE,
} from "../src/presentation/lib/speech";

test("Mandarin voices in simplified Chinese count, others do not", () => {
  for (const lang of ["zh-CN", "zh_CN", "zh-cn", "zh-Hans-CN", "cmn-Hans-CN"])
    assert.equal(isChineseVoice({ lang }), true, lang);
  for (const lang of ["zh-TW", "zh-HK", "ja-JP", "en-US", "zh"])
    assert.equal(isChineseVoice({ lang }), false, lang);
});

test("a voice on the device is picked before a network one", () => {
  const network = { lang: "zh-CN", localService: false, name: "network" };
  const local = { lang: "zh-CN", localService: true, name: "local" };
  const english = { lang: "en-US", localService: true, name: "english" };
  assert.equal(pickChineseVoice([english, network, local]), local);
  assert.equal(pickChineseVoice([english, network]), network);
  assert.equal(pickChineseVoice([english]), undefined);
});

test("pressing again soon reads slower, then normal again", () => {
  const first = nextRate(null, "你好", 0);
  assert.equal(first, 1);
  const second = nextRate({ text: "你好", at: 0, rate: first }, "你好", 1000);
  assert.equal(second, SLOW_RATE);
  const third = nextRate(
    { text: "你好", at: 1000, rate: second },
    "你好",
    2000,
  );
  assert.equal(third, 1);
});

test("another text or a late press reads at normal speed", () => {
  const last = { text: "你好", at: 0, rate: 1 };
  assert.equal(nextRate(last, "谢谢", 1000), 1);
  assert.equal(nextRate(last, "你好", REPLAY_WINDOW_MS), 1);
});
