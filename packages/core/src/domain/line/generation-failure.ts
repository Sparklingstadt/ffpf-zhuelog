import type { LearningKind } from "../learning/entities/learning-entry";

export type GenerationFailureCode =
  | "OPENAI_TIMEOUT"
  | "OPENAI_AUTH_FAILED"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_INVALID_RESPONSE"
  | "OPENAI_REQUEST_FAILED"
  // Set by the server: the result exceeds LINE's limit.
  | "CORRECTION_TOO_LONG";

export class LineGenerationError extends Error {
  constructor(readonly code: GenerationFailureCode) {
    super(code);
  }
}

const reasons: Record<GenerationFailureCode, string> = {
  OPENAI_TIMEOUT: "OpenAIの応答が時間切れになりました。",
  OPENAI_AUTH_FAILED: "OpenAIのAPIキーまたは権限を確認してください。",
  OPENAI_RATE_LIMITED: "OpenAIの利用上限に達しました。",
  OPENAI_INVALID_RESPONSE: "OpenAIの回答を結果として読み取れませんでした。",
  OPENAI_REQUEST_FAILED: "OpenAIで処理を完了できませんでした。",
  CORRECTION_TOO_LONG: "結果がLINEで送れる長さを超えました。",
};

const actions: Record<LearningKind, string> = {
  correction: "添削",
  translation: "翻訳",
};

export function formatGenerationFailure(
  code: GenerationFailureCode,
  kind: LearningKind,
) {
  const retry =
    code === "CORRECTION_TOO_LONG"
      ? "文を短く分けて送信してください。"
      : "時間をおいてもう一度送信してください。";
  return `${actions[kind]}できませんでした。\n${reasons[code]}\n学習ノートは保存していません。${retry}\nエラーコード: ${code}`;
}
