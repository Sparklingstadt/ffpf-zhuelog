// The LINE bot's records and numbers: the rows of the LineLink and
// LineMessage tables, a webhook event, and the limits the webhook, the daily
// pass and the stores keep.

import type { LineLearningKind } from "@/domain/line/line-text";

export type LineMessageStatus = "pending" | "done" | "failed";

// A text the bot accepted for correction or translation.
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

// A LINE account linked to a web account: the owner and the owner's role.
export type LineLink = {
  lineUserId: string;
  ownerId: string;
  role: string;
  createdAt: Date;
};

// One message event of a webhook delivery.
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
// reviews due.
export type ReviewNotifyTarget = {
  lineUserId: string;
  ownerId: string;
  role: string;
  due: number;
};

// The channel's push allowance for the month.
export type LinePushQuota =
  { unlimited: true } | { unlimited: false; remaining: number };

// A failed generation: the OpenAI code, and whether a later attempt may work.
export type GenerationFailure = { code: string; retryable: boolean };

// The most generation attempts one message gets.
export const LINE_MAX_ATTEMPTS = 2;
// The most stale messages one drain pass finishes.
export const LINE_DRAIN_BATCH = 20;
// How long done and failed rows are kept: 7 days.
export const LINE_RETENTION_MS = 604_800_000;
// The code a row is failed with when its attempts ran out with no answer.
export const LINE_EXHAUSTED_CODE = "OPENAI_TIMEOUT";
// The code a row is failed with when its link is gone.
export const LINE_LINK_GONE_CODE = "LINK_GONE";
// The most accounts one pass lists for the morning review message.
export const REVIEW_NOTIFY_BATCH = 100;
// Pushes of the month's allowance the review message never uses.
export const REVIEW_NOTIFY_PUSH_RESERVE = 30;

// The deadline an event's work gets from the start of its delivery, and when
// a delivery stops taking further events; how long the daily pass runs; the
// least time left to start a generation (its budget plus a reply margin); how
// old a pending row is before the drain takes it; the least time left to push.
export const LINE_TIMING = {
  webhookDeliveryBudgetMs: 45_000,
  webhookEventsTimeoutMs: 55_000,
  drainBudgetMs: 50_000,
  minTimeLeftMs: 30_000,
  staleAfterMs: 300_000,
  pushMarginMs: 3_000,
} as const;

// How many review messages one pass may push: min(targets, remaining - 30)
// when limited, never below 0.
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
