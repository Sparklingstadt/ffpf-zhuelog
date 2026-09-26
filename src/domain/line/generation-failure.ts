import { z } from "zod";

export const generationFailureSchema = z.enum([
  "CODEX_TIMEOUT",
  "CODEX_CONNECTION_FAILED",
  "CODEX_AUTH_FAILED",
  "CODEX_MODEL_UNAVAILABLE",
  "CODEX_SAFETY_REJECTED",
  "CODEX_INVALID_RESPONSE",
  "CODEX_REQUEST_FAILED",
]);
export type GenerationFailureCode = z.infer<typeof generationFailureSchema>;

const reasons: Record<GenerationFailureCode, string> = {
  CODEX_TIMEOUT: "Codexの応答が時間切れになりました。",
  CODEX_CONNECTION_FAILED: "MacのCodexを起動できないか、接続が切れました。",
  CODEX_AUTH_FAILED: "Codexのログイン状態を確認してください。",
  CODEX_MODEL_UNAVAILABLE: "添削に使用するモデルを利用できませんでした。",
  CODEX_SAFETY_REJECTED:
    "Codexの応答が許可された処理範囲を外れたため停止しました。",
  CODEX_INVALID_RESPONSE: "Codexの回答を添削結果として読み取れませんでした。",
  CODEX_REQUEST_FAILED: "Codexで添削を完了できませんでした。",
};

export function formatGenerationFailure(code: GenerationFailureCode) {
  return `添削できませんでした。\n${reasons[code]}\n学習ノートは保存していません。復旧後にもう一度送信してください。\nエラーコード: ${code}`;
}
