import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LINE_REPLY,
  formatLineFailure,
  formatLineResult,
  formatReviewReminder,
} from "../src/domain/line/line-replies";
import { reviewNotifyBudget } from "../src/domain/line/line-message";

test("the reply copy is pinned", () => {
  assert.deepEqual(LINE_REPLY, {
    linked:
      "連携しました。これから、このトークに送った文を添削・翻訳して学習ノートに保存します。",
    relinked:
      "連携先を切り替えました。これからは新しいアカウントの学習ノートに保存します。",
    badCode:
      "コードが違うか期限が切れています。Web の連携画面で新しいコードを出して、もう一度送ってください。",
    throttled: "連携コードの試行が多すぎます。しばらくしてから試してください。",
    notLinked:
      "まだ連携していません。Web のアカウント画面（/account/line）で連携コードを出して、このトークに送ってください。",
    linkGone:
      "連携が切れました。もう一度つなぐには、Web のアカウント画面（/account/line）で連携コードを出して、このトークに送ってください。",
    tooLong: "文が長すぎます。500 文字までにして、もう一度送ってください。",
    usage:
      "中国語の文を送ると添削します。日本語の文を送ると中国語に翻訳します。結果は学習ノートに保存されます。",
    slow: "時間がかかっています。結果は翌朝までにこのトークにお送りします。",
  });
});

test("a result lists the original, the answer, pinyin and hints", () => {
  const generation = {
    text: "我去学校了",
    pinyin: "wǒ qù xuéxiào le",
    hints: ["了の位置", "語順"],
  };
  assert.equal(
    formatLineResult("correction", "我去了学校", generation),
    "【元の文】\n我去了学校\n\n【添削後】\n我去学校了\n\n【ピンイン】\nwǒ qù xuéxiào le\n\n【ヒント】\n・了の位置\n・語順\n\n学習ノートに保存しました",
  );
  assert.equal(
    formatLineResult("translation", "学校に行った", generation),
    "【元の文】\n学校に行った\n\n【中国語訳】\n我去学校了\n\n【ピンイン】\nwǒ qù xuéxiào le\n\n【ヒント】\n・了の位置\n・語順\n\n学習ノートに保存しました",
  );
  assert.equal(
    formatLineResult("correction", "x", { text: "y", pinyin: "", hints: [] }),
    "【元の文】\nx\n\n【添削後】\ny\n\n学習ノートに保存しました",
  );
});

test("an oversized result is cut to one LINE message", () => {
  const suffix = "\n\n学習ノートに保存しました";
  for (const body of ["字".repeat(6000), "😀".repeat(6000)]) {
    const out = formatLineResult("correction", "x", {
      text: body,
      pinyin: "",
      hints: [],
    });
    assert.equal([...out].length, 5000);
    assert.ok(out.endsWith(suffix));
    assert.ok(out.isWellFormed());
  }
});

test("failures name the reason and the code", () => {
  assert.equal(
    formatLineFailure("correction", "OPENAI_RATE_LIMITED"),
    "添削できませんでした。AI の利用が混み合っています。しばらくしてからもう一度送ってください。\n（コード: OPENAI_RATE_LIMITED）",
  );
  assert.equal(
    formatLineFailure("translation", "OPENAI_TIMEOUT"),
    "翻訳できませんでした。AI の返事が間に合いませんでした。しばらくしてからもう一度送ってください。\n（コード: OPENAI_TIMEOUT）",
  );
  assert.equal(
    formatLineFailure("correction", "OPENAI_INVALID_RESPONSE"),
    "添削できませんでした。AI の返事を読み取れませんでした。文を変えてもう一度送ってください。\n（コード: OPENAI_INVALID_RESPONSE）",
  );
  assert.equal(
    formatLineFailure("correction", "OPENAI_AUTH_FAILED"),
    "添削できませんでした。AI との接続の設定に問題があります。管理者に知らせてください。\n（コード: OPENAI_AUTH_FAILED）",
  );
  assert.equal(
    formatLineFailure("correction", "LINK_GONE"),
    "添削できませんでした。うまく処理できませんでした。しばらくしてからもう一度送ってください。\n（コード: LINK_GONE）",
  );
  assert.equal(
    formatLineFailure("translation", "OPENAI_REQUEST_FAILED"),
    "翻訳できませんでした。うまく処理できませんでした。しばらくしてからもう一度送ってください。\n（コード: OPENAI_REQUEST_FAILED）",
  );
});

test("the review reminder is pinned", () => {
  assert.equal(
    formatReviewReminder(3),
    "今日の復習が 3 問あります。Web の「今日の復習」（/review）で答えましょう。\n\nこのお知らせは、Web のアカウント画面（/account/line）で止められます。",
  );
});

test("the push budget keeps 30 for late corrections", () => {
  assert.equal(reviewNotifyBudget(5, { unlimited: true }), 5);
  assert.equal(reviewNotifyBudget(5, { unlimited: false, remaining: 200 }), 5);
  assert.equal(reviewNotifyBudget(5, { unlimited: false, remaining: 32 }), 2);
  assert.equal(reviewNotifyBudget(5, { unlimited: false, remaining: 10 }), 0);
});
