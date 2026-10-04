import type { CorrectionFailure } from "@ffpf-zhuelog/core/domain/practice/personal-correction";

// Failures from the correction itself plus rejections of the HTTP request.
export type CorrectionErrorCode =
  CorrectionFailure | "unauthorized" | "origin" | "tooLarge";

export const correctionErrors: Record<CorrectionErrorCode, string> = {
  invalid: "入力・APIキー・同意を確認してください（原文は500文字以内）。",
  unauthorized: "ログインし直してください。",
  origin: "この画面から送信してください。",
  tooLarge: "送信するデータが大きすぎます。",
  key: "APIキーが無効か、このモデルを利用する権限がありません。",
  limited: "利用上限・残高・連続送信制限を確認し、時間をおいてお試しください。",
  timeout:
    "応答が時間内に届きませんでした。自動再試行はしません。OpenAI側で料金が発生している可能性があります。",
  unavailable:
    "添削結果を取得できませんでした。自動再試行はしません。OpenAI側で料金が発生している可能性があります。",
};
