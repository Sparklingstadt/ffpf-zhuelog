import type { ThrottleRule } from "../../domain/identity/sign-in-throttle";
import { trimWhiteSpace } from "../../domain/line/white-space";
import {
  type GenerationFailure,
  LINE_DRAIN_BATCH,
  LINE_EXHAUSTED_CODE,
  LINE_LINK_GONE_CODE,
  LINE_MAX_ATTEMPTS,
  LINE_TIMING,
  REVIEW_NOTIFY_BATCH,
  reviewNotifyBudget,
  type LineEvent,
  type LineLink,
  type LineMessage,
  type LinePushQuota,
  type ReviewNotifyTarget,
} from "../../domain/line/line-message";
import {
  formatLineFailure,
  formatLineResult,
  formatReviewReminder,
  LINE_REPLY,
  type LineGeneration,
} from "../../domain/line/line-replies";
import {
  classifyLineText,
  type LineLearningKind,
} from "../../domain/line/line-text";
import {
  lineLinkThrottleKey,
  LINK_REDEEM_THROTTLE,
  readLinkCode,
} from "../../domain/line/link-code";
import type { OpenAiUsage } from "../../domain/vocabulary/vocabulary-entry";

export type GenerationOutcome =
  | { ok: true; generation: LineGeneration }
  | { ok: false; failure: GenerationFailure };

export type LineBotDeps = {
  links: {
    find(lineUserId: string): Promise<LineLink | null>;
    unlinkLineUser(lineUserId: string): Promise<void>;
    redeemCode(
      codeHash: string,
      lineUserId: string,
      now: Date,
    ): Promise<{ ownerId: string; role: string; relinked: boolean } | null>;
    reviewNotifyTargets(
      now: Date,
      limit: number,
    ): Promise<ReviewNotifyTarget[]>;
    claimReviewNotify(lineUserId: string, now: Date): Promise<boolean>;
  };
  messages: {
    insert(
      message: {
        webhookEventId: string;
        lineUserId: string;
        ownerId: string;
        kind: LineLearningKind;
        text: string;
      },
      now: Date,
    ): Promise<{ message: LineMessage; created: boolean }>;
    startAttempt(id: string, now: Date): Promise<LineMessage | null>;
    complete(
      id: string,
      ownerId: string,
      note: {
        kind: LineLearningKind;
        originalText: string;
        generation: LineGeneration;
      },
      now: Date,
    ): Promise<boolean>;
    fail(id: string, now: Date): Promise<void>;
    listStale(createdBefore: Date, limit: number): Promise<LineMessage[]>;
    prune(now: Date): Promise<void>;
  };
  throttle: {
    consume(key: string, rule: ThrottleRule, now: Date): Promise<boolean>;
    reset(key: string): Promise<void>;
  };
  // One OpenAI call; usage is reported (also for an unusable answer) before
  // it settles.
  generate(
    kind: LineLearningKind,
    text: string,
    onUsage: (usage: OpenAiUsage) => void,
  ): Promise<GenerationOutcome>;
  // Never throws (recordWithin).
  recordUsage(ownerId: string, usage: OpenAiUsage): Promise<void>;
  messenger: {
    reply(replyToken: string, texts: string[]): Promise<void>;
    push(to: string, texts: string[]): Promise<void>;
  };
  quota: { pushQuota(): Promise<LinePushQuota> };
  ownerValid(ownerId: string, role: string): Promise<boolean>;
  hashCode(code: string): string;
  now(): Date;
  // Fixed codes with ids, OpenAI codes and counts only: never a text, a LINE
  // user id, a reply token, a code or an owner id.
  log(code: string, fields?: Record<string, string | number>): void;
};

// What generateAndSave came to: a saved note, a failed generation (the row
// is still pending for the caller to settle), or a row someone else settled.
type SaveResult =
  | { status: "saved"; generation: LineGeneration }
  | { status: "failed"; failure: GenerationFailure }
  | { status: "settled" };

// The LINE bot (Go: services/api/linebot): one webhook event at a time, and
// the daily pass that finishes stale messages and sends the morning review
// message. Go's order of operations, time windows and retries are kept.
export function createLineBot(deps: LineBotDeps) {
  const { links, messages } = deps;

  // Go: reply. A failure is logged with the event id and thrown; it never
  // changes stored state.
  async function reply(event: LineEvent, text: string): Promise<void> {
    try {
      await deps.messenger.reply(event.replyToken, [text]);
    } catch (error) {
      deps.log("LINE_REPLY_FAILED", { eventId: event.webhookEventId });
      throw error;
    }
  }

  // Go: push. A failure is logged with the message id and thrown.
  async function push(row: LineMessage, text: string): Promise<void> {
    try {
      await deps.messenger.push(row.lineUserId, [text]);
    } catch (error) {
      deps.log("LINE_PUSH_FAILED", { messageId: row.id });
      throw error;
    }
  }

  // Go: failMessage. Marks the row failed, then logs why.
  async function failMessage(id: string, code: string): Promise<void> {
    await messages.fail(id, deps.now());
    deps.log("LINE_MESSAGE_FAILED", { messageId: id, code });
  }

  // Go: generateAndSave. The tokens are recorded under the row's owner once
  // OpenAI answered, even when the answer is unusable. A store failure is
  // thrown.
  async function generateAndSave(
    id: string,
    ownerId: string,
    kind: LineLearningKind,
    text: string,
  ): Promise<SaveResult> {
    const usages: OpenAiUsage[] = [];
    let outcome: GenerationOutcome;
    try {
      outcome = await deps.generate(kind, text, (usage) => usages.push(usage));
    } catch {
      outcome = {
        ok: false,
        failure: { code: "OPENAI_REQUEST_FAILED", retryable: false },
      };
    }
    for (const usage of usages) await deps.recordUsage(ownerId, usage);
    if (!outcome.ok) return { status: "failed", failure: outcome.failure };
    const saved = await messages.complete(
      id,
      ownerId,
      { kind, originalText: text, generation: outcome.generation },
      deps.now(),
    );
    if (!saved) {
      deps.log("LINE_MESSAGE_SETTLED", { messageId: id });
      return { status: "settled" };
    }
    return { status: "saved", generation: outcome.generation };
  }

  // Go: redeem. Every attempt counts against the LINE account's hour.
  async function redeem(event: LineEvent, code: string): Promise<void> {
    const key = lineLinkThrottleKey(event.userId);
    if (!(await deps.throttle.consume(key, LINK_REDEEM_THROTTLE, deps.now())))
      return reply(event, LINE_REPLY.throttled);
    const linked = await links.redeemCode(
      deps.hashCode(code),
      event.userId,
      deps.now(),
    );
    if (!linked) return reply(event, LINE_REPLY.badCode);
    try {
      await deps.throttle.reset(key);
    } catch {
      // Only costs the user part of their attempts; the link is made.
      deps.log("LINE_THROTTLE_RESET_FAILED", { eventId: event.webhookEventId });
    }
    return reply(
      event,
      linked.relinked ? LINE_REPLY.relinked : LINE_REPLY.linked,
    );
  }

  // Go: process. Saves the text, generates and saves the note, and replies.
  async function process(
    event: LineEvent,
    link: LineLink,
    kind: LineLearningKind,
    text: string,
    deadline: Date,
  ): Promise<void> {
    // The event id is the dedup key; an empty one would collide.
    if (event.webhookEventId === "") {
      deps.log("LINE_EVENT_WITHOUT_ID");
      return;
    }
    const { message, created } = await messages.insert(
      {
        webhookEventId: event.webhookEventId,
        lineUserId: event.userId,
        ownerId: link.ownerId,
        kind,
        text,
      },
      deps.now(),
    );
    // A redelivery: already handled, or waiting for the drain.
    if (!created) return;
    if (deadline.getTime() - deps.now().getTime() < LINE_TIMING.minTimeLeftMs) {
      // Too late in the delivery to call OpenAI: the row stays pending and
      // the next drain finishes it.
      deps.log("LINE_MESSAGE_DEFERRED", { messageId: message.id });
      return reply(event, LINE_REPLY.slow);
    }
    if (!(await messages.startAttempt(message.id, deps.now()))) return;

    let result: SaveResult;
    try {
      result = await generateAndSave(message.id, link.ownerId, kind, text);
    } catch (error) {
      // The row stays pending for the drain; the store's failure wins.
      await reply(event, LINE_REPLY.slow).catch(() => {});
      throw error;
    }
    if (result.status === "settled") return;
    if (result.status === "failed") {
      const { code, retryable } = result.failure;
      if (retryable) {
        deps.log("LINE_GENERATION_RETRY", { messageId: message.id, code });
        return reply(event, LINE_REPLY.slow);
      }
      await failMessage(message.id, code);
      return reply(event, formatLineFailure(kind, code));
    }
    return reply(event, formatLineResult(kind, text, result.generation));
  }

  // Go: drainRow. Store failures and failed pushes are thrown.
  async function drainRow(row: LineMessage): Promise<void> {
    // The link decides whether the note may still be saved.
    const link = await links.find(row.lineUserId);
    if (!link || link.ownerId !== row.ownerId)
      return failMessage(row.id, LINE_LINK_GONE_CODE);
    if (!(await deps.ownerValid(link.ownerId, link.role))) {
      await links.unlinkLineUser(row.lineUserId);
      await failMessage(row.id, LINE_LINK_GONE_CODE);
      return push(row, LINE_REPLY.linkGone);
    }
    const started = await messages.startAttempt(row.id, deps.now());
    if (!started) {
      // Settled by someone else since the listing.
      if (row.attempts < LINE_MAX_ATTEMPTS) return;
      // Both attempts are spent and no answer came: give up.
      await failMessage(row.id, LINE_EXHAUSTED_CODE);
      return push(row, formatLineFailure(row.kind, LINE_EXHAUSTED_CODE));
    }
    const result = await generateAndSave(
      started.id,
      started.ownerId,
      started.kind,
      started.text,
    );
    if (result.status === "settled") return;
    if (result.status === "failed") {
      // The drain's attempt is the last one: even a retryable failure ends.
      await failMessage(started.id, result.failure.code);
      return push(row, formatLineFailure(started.kind, result.failure.code));
    }
    return push(
      row,
      formatLineResult(started.kind, started.text, result.generation),
    );
  }

  // Go: Drain. Prunes first, then finishes the oldest stale rows; a row
  // with attempts left is not started with less than minTimeLeft to go.
  async function drain(deadline: Date, errors: unknown[]): Promise<void> {
    try {
      await messages.prune(deps.now());
    } catch (error) {
      errors.push(error);
    }
    let rows: LineMessage[];
    try {
      rows = await messages.listStale(
        new Date(deps.now().getTime() - LINE_TIMING.staleAfterMs),
        LINE_DRAIN_BATCH,
      );
    } catch (error) {
      errors.push(error);
      return;
    }
    for (const row of rows) {
      const left = deadline.getTime() - deps.now().getTime();
      if (left <= 0) break;
      if (row.attempts < LINE_MAX_ATTEMPTS && left < LINE_TIMING.minTimeLeftMs)
        continue;
      try {
        await drainRow(row);
      } catch (error) {
        errors.push(error);
      }
    }
  }

  // Go: NotifyDueReviews. At most once per owner and JST day, within the
  // month's push allowance minus the reserve.
  async function notify(deadline: Date, errors: unknown[]): Promise<void> {
    let targets: ReviewNotifyTarget[];
    try {
      targets = await links.reviewNotifyTargets(
        deps.now(),
        REVIEW_NOTIFY_BATCH,
      );
    } catch (error) {
      errors.push(error);
      return;
    }
    if (targets.length === 0) return;
    let quota: LinePushQuota;
    try {
      quota = await deps.quota.pushQuota();
    } catch (error) {
      deps.log("LINE_REVIEW_NOTIFY_QUOTA_UNKNOWN");
      errors.push(error);
      return;
    }
    const budget = reviewNotifyBudget(targets.length, quota);
    if (budget < targets.length)
      deps.log("LINE_REVIEW_NOTIFY_LIMITED", {
        wanted: targets.length,
        allowed: budget,
      });

    let sent = 0;
    for (const target of targets) {
      if (
        sent >= budget ||
        deadline.getTime() - deps.now().getTime() < LINE_TIMING.pushMarginMs
      )
        break;
      try {
        // Owners who may no longer use LINE are skipped (the webhook and
        // the drain remove their links).
        if (!(await deps.ownerValid(target.ownerId, target.role))) continue;
        if (!(await links.claimReviewNotify(target.lineUserId, deps.now())))
          continue;
      } catch (error) {
        errors.push(error);
        continue;
      }
      try {
        await deps.messenger.push(target.lineUserId, [
          formatReviewReminder(target.due),
        ]);
      } catch (error) {
        // Not retried that day: the claim stays.
        deps.log("LINE_REVIEW_NOTIFY_PUSH_FAILED");
        errors.push(error);
        continue;
      }
      sent++;
    }
    deps.log("LINE_REVIEW_NOTIFY_SENT", { count: sent });
  }

  return {
    // Go: HandleEvent. Throws a store failure, or a reply failure when
    // nothing else failed; the caller logs the event id and goes on.
    async handleEvent(event: LineEvent, deadline: Date): Promise<void> {
      // userId is also filled for group and room events: gate on the source.
      if (!event.fromUser || event.userId === "") return;
      const text = trimWhiteSpace(event.text);

      if (event.isText) {
        const code = readLinkCode(text);
        // Before the link and owner checks, so an owner who may no longer
        // use LINE can still switch accounts.
        if (code !== null) return redeem(event, code);
      }

      const link = await links.find(event.userId);
      if (!link) return reply(event, LINE_REPLY.notLinked);
      if (!(await deps.ownerValid(link.ownerId, link.role))) {
        await links.unlinkLineUser(event.userId);
        return reply(event, LINE_REPLY.linkGone);
      }
      if (!event.isText) return reply(event, LINE_REPLY.usage);
      const route = classifyLineText(text);
      if (route === "too-long") return reply(event, LINE_REPLY.tooLong);
      if (route === "unsupported") return reply(event, LINE_REPLY.usage);
      return process(event, link, route, text, deadline);
    },

    // Go: Drain, then NotifyDueReviews even when the drain failed. Throws an
    // AggregateError of what failed, after both passes.
    async runDailyPass(deadline: Date): Promise<void> {
      const errors: unknown[] = [];
      await drain(deadline, errors);
      await notify(deadline, errors);
      if (errors.length > 0)
        throw new AggregateError(errors, "LINE_DAILY_PASS_FAILED");
    },
  };
}

// Go: main.go ownerValid. Admins must still be on the allowlist; members
// must still exist; any other role never may.
export function createLineOwnerCheck(deps: {
  adminIds: ReadonlySet<string>;
  memberExists(ownerId: string): Promise<boolean>;
}): (ownerId: string, role: string) => Promise<boolean> {
  return async (ownerId, role) => {
    if (role === "admin") return deps.adminIds.has(ownerId);
    if (role === "member") return deps.memberExists(ownerId);
    return false;
  };
}
