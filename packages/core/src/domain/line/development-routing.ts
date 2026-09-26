import { developmentStartedReply } from "./development-mode";

export function routeDevelopmentMessage(
  input: { originalText: string; receivedAt: Date },
  session: { expiresAt: Date | null; lastEventAt: Date },
  now = new Date(),
) {
  let expiresAt = session.expiresAt;
  let replyText: string | null = null;
  let kind = "dev-reply";
  let status = "READY";
  if (input.originalText === "/devend") {
    expiresAt = null;
    replyText =
      "開発モードを終了しました。以降は通常の中文添削に戻ります。受付済みのIssue作成は継続します。";
  } else if (input.receivedAt < session.lastEventAt) {
    replyText =
      "受信順が前後したため、このメッセージは処理しませんでした。現在のモードを確認してから再送してください。終了：/devend";
  } else if (input.originalText === "/dev") {
    expiresAt = new Date(input.receivedAt.getTime() + 24 * 60 * 60 * 1000);
    replyText = developmentStartedReply;
  } else if (expiresAt && (expiresAt <= input.receivedAt || expiresAt <= now)) {
    expiresAt = null;
    replyText =
      "開発モードの24時間の期限が切れました。この文はIssueにも学習ノートにも登録していません。続ける場合は /dev を送ってください。";
  } else if (expiresAt) {
    kind = "dev-issue";
    status = "PENDING";
  } else if (/\p{Script=Han}/u.test(input.originalText)) {
    kind = "correction";
    status = "PENDING";
  } else status = "IGNORED";
  return {
    session: {
      expiresAt,
      lastEventAt:
        input.receivedAt > session.lastEventAt
          ? input.receivedAt
          : session.lastEventAt,
    },
    job: {
      kind,
      status,
      replyText,
      originalText: status === "IGNORED" ? "" : input.originalText,
    },
  };
}
