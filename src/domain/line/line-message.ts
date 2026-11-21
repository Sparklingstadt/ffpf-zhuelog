// The LINE bot's records and numbers, with Go's meanings: Go and the web share
// the LineLink and LineMessage tables while LINE moves to the web
// (services/api/store/line.go, services/api/linebot).

import type { LineLearningKind } from "@/domain/line/line-text";

export type LineMessageStatus = "pending" | "done" | "failed";

// A text the bot accepted for correction or translation. Go: store.LineMessage.
export type LineMessage = {
  id: string;
  webhookEventId: string;
  lineUserId: string;
  ownerId: string;
  kind: LineLearningKind;
  // "" once done or failed.
  text: string;
  status: LineMessageStatus;
  attempts: number;
  createdAt: Date;
};

// Go: store.LineLink.
export type LineLink = {
  lineUserId: string;
  ownerId: string;
  role: string;
  createdAt: Date;
};

// One message event of a webhook delivery. Go: line.Event
// (services/api/line/webhook.go).
export type LineEvent = {
  webhookEventId: string;
  replyToken: string;
  userId: string;
  // "" unless isText.
  text: string;
  isText: boolean;
  fromUser: boolean;
};

// A linked account that asked for the morning review message and has
// reviews due. Go: store.ReviewNotifyTarget.
export type ReviewNotifyTarget = {
  lineUserId: string;
  ownerId: string;
  role: string;
  due: number;
};

// The channel's push allowance for the month. Go: line.Quota.
export type LinePushQuota =
  { unlimited: true } | { unlimited: false; remaining: number };

// A failed generation: the OpenAI code, and whether a later attempt may work.
export type GenerationFailure = { code: string; retryable: boolean };

// Go: store.LineMaxAttempts (store/line.go:20).
export const LINE_MAX_ATTEMPTS = 2;
// Go: drainBatch (linebot/drain.go:18).
export const LINE_DRAIN_BATCH = 20;
// Go: lineRetention (store/line.go:24), 7 days for done and failed rows.
export const LINE_RETENTION_MS = 604_800_000;
// Go: exhaustedCode (linebot/drain.go:30).
export const LINE_EXHAUSTED_CODE = "OPENAI_TIMEOUT";
// Go: the code a row is failed with when its link is gone (linebot/drain.go:80).
export const LINE_LINK_GONE_CODE = "LINK_GONE";
// Go: notifyBatch (linebot/notify.go:14).
export const REVIEW_NOTIFY_BATCH = 100;
// Go: notifyPushReserve (linebot/notify.go:17).
export const REVIEW_NOTIFY_PUSH_RESERVE = 30;

// Go: webhookDeliveryBudget and webhookEventsTimeout
// (httpapi/line_handlers.go:43-48), drainBudget (:40), minTimeLeft = generation
// budget + reply margin, staleAfter (linebot/drain.go:16-27), pushMargin
// (linebot/notify.go:19).
export const LINE_TIMING = {
  webhookDeliveryBudgetMs: 45_000,
  webhookEventsTimeoutMs: 55_000,
  drainBudgetMs: 50_000,
  minTimeLeftMs: 30_000,
  staleAfterMs: 300_000,
  pushMarginMs: 3_000,
} as const;

// Go: NotifyDueReviews' budget (linebot/notify.go:45-106). min(targets,
// remaining - 30) when limited, never below 0.
export function reviewNotifyBudget(
  targets: number,
  quota: LinePushQuota,
): number {
  if (quota.unlimited) return targets;
  return Math.max(
    0,
    Math.min(targets, quota.remaining - REVIEW_NOTIFY_PUSH_RESERVE),
  );
}
