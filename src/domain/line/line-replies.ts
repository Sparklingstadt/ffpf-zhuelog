// What the LINE bot sends, copied verbatim from Go's line/format.go
// (services/api/line/format.go). LINE users see these words as they are.

import type { LineLearningKind } from "@/domain/line/line-text";

// Go: the Msg* constants (format.go:13-23).
export const LINE_REPLY = {
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
} as const;

// Go: maxMessageRunes (format.go:10), LINE's limit for one text message,
// counted in code points.
export const LINE_MESSAGE_MAX_CODE_POINTS = 5000;

// What OpenAI made of a text: the corrected or translated sentence, its
// pinyin and the Japanese hints.
export type LineGeneration = { text: string; pinyin: string; hints: string[] };

const SAVED_SUFFIX = "\n\n学習ノートに保存しました";

// Go: FormatResult (format.go:31-56). The body is cut so the whole message,
// suffix included, stays one LINE message; never inside a code point.
export function formatLineResult(
  kind: LineLearningKind,
  original: string,
  generation: LineGeneration,
): string {
  const heading = kind === "translation" ? "【中国語訳】" : "【添削後】";
  const sections = [
    `【元の文】\n${original}`,
    `${heading}\n${generation.text}`,
  ];
  if (generation.pinyin !== "")
    sections.push(`【ピンイン】\n${generation.pinyin}`);
  if (generation.hints.length > 0)
    sections.push(
      `【ヒント】\n${generation.hints.map((h) => `・${h}`).join("\n")}`,
    );
  let body = sections.join("\n\n");
  const limit = LINE_MESSAGE_MAX_CODE_POINTS - [...SAVED_SUFFIX].length;
  const chars = [...body];
  if (chars.length > limit) body = chars.slice(0, limit).join("");
  return body + SAVED_SUFFIX;
}

// Go: FormatFailure (format.go:60-66).
export function formatLineFailure(
  kind: LineLearningKind,
  code: string,
): string {
  const head =
    kind === "translation"
      ? "翻訳できませんでした。"
      : "添削できませんでした。";
  return `${head}${failureReason(code)}\n（コード: ${code}）`;
}

// Go: failureReason (format.go:68-81).
function failureReason(code: string): string {
  switch (code) {
    case "OPENAI_RATE_LIMITED":
      return "AI の利用が混み合っています。しばらくしてからもう一度送ってください。";
    case "OPENAI_INVALID_RESPONSE":
      return "AI の返事を読み取れませんでした。文を変えてもう一度送ってください。";
    case "OPENAI_AUTH_FAILED":
      return "AI との接続の設定に問題があります。管理者に知らせてください。";
    case "OPENAI_TIMEOUT":
      return "AI の返事が間に合いませんでした。しばらくしてからもう一度送ってください。";
    default:
      return "うまく処理できませんでした。しばらくしてからもう一度送ってください。";
  }
}

// Go: FormatReviewReminder (format.go:85-87).
export function formatReviewReminder(due: number): string {
  return `今日の復習が ${due} 問あります。Web の「今日の復習」（/review）で答えましょう。\n\nこのお知らせは、Web のアカウント画面（/account/line）で止められます。`;
}
