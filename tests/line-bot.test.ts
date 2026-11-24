import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  createLineBot,
  createLineOwnerCheck,
  type GenerationOutcome,
  type LineBotDeps,
} from "../src/application/line/line-bot";
import type {
  LineEvent,
  LineLink,
  LineMessage,
  ReviewNotifyTarget,
} from "../src/domain/line/line-message";
import {
  formatLineFailure,
  formatLineResult,
  formatReviewReminder,
  LINE_REPLY,
  type LineGeneration,
} from "../src/domain/line/line-replies";
import type { OpenAiUsage } from "../src/domain/vocabulary/vocabulary-entry";

const t0 = new Date("2026-11-17T03:00:00.000Z");
const deadline = new Date(t0.getTime() + 45_000);
const link: LineLink = {
  lineUserId: "U1",
  ownerId: "password:c1",
  role: "member",
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
};
const generation: LineGeneration = {
  text: "我去学校了",
  pinyin: "wǒ",
  hints: ["h"],
};
const usage: OpenAiUsage = {
  model: "gpt-5-mini",
  inputTokens: 12,
  outputTokens: 34,
};

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function textEvent(text: string, more: Partial<LineEvent> = {}): LineEvent {
  return {
    webhookEventId: "E1",
    replyToken: "r1",
    userId: "U1",
    text,
    isText: true,
    fromUser: true,
    ...more,
  };
}

const sticker: LineEvent = {
  webhookEventId: "E1",
  replyToken: "r1",
  userId: "U1",
  text: "",
  isText: false,
  fromUser: true,
};

function row(id: string, attempts: number, more: Partial<LineMessage> = {}) {
  return {
    id,
    webhookEventId: `E-${id}`,
    lineUserId: "U1",
    ownerId: "password:c1",
    kind: "correction",
    text: "我去了学校",
    status: "pending",
    attempts,
    createdAt: new Date(t0.getTime() - 600_000),
    ...more,
  } satisfies LineMessage;
}

// Every log line of every test, checked at the end of the file.
const allLogs: unknown[] = [];

type Call = [string, ...unknown[]];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Impl = (...args: any[]) => unknown;

// Fakes that record every call in order. over replaces a fake's answer by
// the call's name; clock moves the time.
function harness(over: Record<string, Impl> = {}) {
  const calls: Call[] = [];
  const logs: [string, Record<string, string | number> | undefined][] = [];
  let clock = t0.getTime();
  const call =
    (name: string, base: Impl) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return (over[name] ?? base)(...args);
    };
  const deps: LineBotDeps = {
    links: {
      find: call("find", () => link) as LineBotDeps["links"]["find"],
      unlinkLineUser: call(
        "unlinkLineUser",
        () => undefined,
      ) as LineBotDeps["links"]["unlinkLineUser"],
      redeemCode: call("redeemCode", () => ({
        ownerId: "password:c1",
        role: "member",
        relinked: false,
      })) as LineBotDeps["links"]["redeemCode"],
      reviewNotifyTargets: call(
        "reviewNotifyTargets",
        () => [],
      ) as LineBotDeps["links"]["reviewNotifyTargets"],
      claimReviewNotify: call(
        "claimReviewNotify",
        () => true,
      ) as LineBotDeps["links"]["claimReviewNotify"],
    },
    messages: {
      insert: call("insert", (message: Omit<LineMessage, "id">, now: Date) => ({
        message: {
          ...message,
          id: "m1",
          status: "pending",
          attempts: 0,
          createdAt: now,
        },
        created: true,
      })) as LineBotDeps["messages"]["insert"],
      startAttempt: call("startAttempt", (id: string) => ({
        ...row(id, 1),
      })) as LineBotDeps["messages"]["startAttempt"],
      complete: call(
        "complete",
        () => true,
      ) as LineBotDeps["messages"]["complete"],
      fail: call("fail", () => undefined) as LineBotDeps["messages"]["fail"],
      listStale: call(
        "listStale",
        () => [],
      ) as LineBotDeps["messages"]["listStale"],
      prune: call("prune", () => undefined) as LineBotDeps["messages"]["prune"],
    },
    throttle: {
      consume: call(
        "consume",
        () => true,
      ) as LineBotDeps["throttle"]["consume"],
      reset: call("reset", () => undefined) as LineBotDeps["throttle"]["reset"],
    },
    async generate(kind, text, onUsage) {
      calls.push(["generate", kind, text]);
      onUsage(usage);
      const answer = over.generate
        ? over.generate(kind, text)
        : ({ ok: true, generation } satisfies GenerationOutcome);
      return answer as GenerationOutcome;
    },
    recordUsage: call(
      "recordUsage",
      () => undefined,
    ) as LineBotDeps["recordUsage"],
    messenger: {
      reply: call(
        "reply",
        () => undefined,
      ) as LineBotDeps["messenger"]["reply"],
      push: call("push", () => undefined) as LineBotDeps["messenger"]["push"],
    },
    quota: {
      pushQuota: call("pushQuota", () => ({
        unlimited: true,
      })) as LineBotDeps["quota"]["pushQuota"],
    },
    ownerValid: call("ownerValid", () => true) as LineBotDeps["ownerValid"],
    hashCode: sha256hex,
    now: () => new Date(clock),
    log(code, fields) {
      logs.push([code, fields]);
      allLogs.push(code, fields);
    },
  };
  return {
    bot: createLineBot(deps),
    calls,
    logs,
    names: () => calls.map((c) => c[0]),
    setClock(ms: number) {
      clock = ms;
    },
  };
}

const boom = () => {
  throw new Error("boom");
};

test("group and room events are ignored", async () => {
  for (const event of [
    textEvent("我去了学校", { fromUser: false }),
    textEvent("我去了学校", { userId: "" }),
  ]) {
    const h = harness();
    await h.bot.handleEvent(event, deadline);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.logs, []);
  }
});

test("an unlinked sender is told how to link", async () => {
  for (const event of [textEvent("我去了学校"), sticker]) {
    const h = harness({ find: () => null });
    await h.bot.handleEvent(event, deadline);
    assert.deepEqual(h.calls, [
      ["find", "U1"],
      ["reply", "r1", [LINE_REPLY.notLinked]],
    ]);
  }
});

test("a code links the account, counted against the hour", async () => {
  const key = "line-link:U1";
  const rule = { limit: 5, windowMs: 3_600_000 };

  let h = harness();
  await h.bot.handleEvent(textEvent(" abcd2345 "), deadline);
  assert.deepEqual(h.calls, [
    ["consume", key, rule, t0],
    ["redeemCode", sha256hex("ABCD2345"), "U1", t0],
    ["reset", key],
    ["reply", "r1", [LINE_REPLY.linked]],
  ]);

  h = harness({
    redeemCode: () => ({ ownerId: "10001", role: "admin", relinked: true }),
  });
  await h.bot.handleEvent(textEvent("ABCD2345"), deadline);
  assert.deepEqual(h.calls.at(-1), ["reply", "r1", [LINE_REPLY.relinked]]);

  h = harness({ redeemCode: () => null });
  await h.bot.handleEvent(textEvent("ABCD2345"), deadline);
  assert.deepEqual(h.names(), ["consume", "redeemCode", "reply"]);
  assert.deepEqual(h.calls.at(-1), ["reply", "r1", [LINE_REPLY.badCode]]);

  h = harness({ consume: () => false });
  await h.bot.handleEvent(textEvent("ABCD2345"), deadline);
  assert.deepEqual(h.calls, [
    ["consume", key, rule, t0],
    ["reply", "r1", [LINE_REPLY.throttled]],
  ]);

  // The code goes first: an owner who may no longer use LINE can switch.
  h = harness({ ownerValid: () => false });
  await h.bot.handleEvent(textEvent("ABCD2345"), deadline);
  assert.deepEqual(h.names(), ["consume", "redeemCode", "reset", "reply"]);

  // A failed reset is only logged; the link is made.
  h = harness({ reset: boom });
  await h.bot.handleEvent(textEvent("ABCD2345"), deadline);
  assert.deepEqual(h.logs, [["LINE_THROTTLE_RESET_FAILED", { eventId: "E1" }]]);
  assert.deepEqual(h.calls.at(-1), ["reply", "r1", [LINE_REPLY.linked]]);

  // A throttle failure is the store's: thrown, no reply.
  h = harness({ consume: boom });
  await assert.rejects(h.bot.handleEvent(textEvent("ABCD2345"), deadline));
  assert.deepEqual(h.names(), ["consume"]);
});

test("an owner who may no longer use LINE loses the link", async () => {
  let h = harness({ ownerValid: () => false });
  await h.bot.handleEvent(textEvent("我去了学校"), deadline);
  assert.deepEqual(h.calls, [
    ["find", "U1"],
    ["ownerValid", "password:c1", "member"],
    ["unlinkLineUser", "U1"],
    ["reply", "r1", [LINE_REPLY.linkGone]],
  ]);

  h = harness({ ownerValid: boom });
  await assert.rejects(h.bot.handleEvent(textEvent("我去了学校"), deadline), {
    message: "boom",
  });
  assert.deepEqual(h.names(), ["find", "ownerValid"]);
});

test("stickers, other scripts and long texts get the usage or length reply", async () => {
  for (const [event, reply] of [
    [sticker, LINE_REPLY.usage],
    [textEvent("hello"), LINE_REPLY.usage],
    [textEvent("漢".repeat(501)), LINE_REPLY.tooLong],
  ] as const) {
    const h = harness();
    await h.bot.handleEvent(event, deadline);
    assert.deepEqual(h.names(), ["find", "ownerValid", "reply"]);
    assert.deepEqual(h.calls.at(-1), ["reply", "r1", [reply]]);
  }

  // Trailing spaces are not counted.
  const h = harness();
  await h.bot.handleEvent(textEvent("漢".repeat(500) + "  "), deadline);
  assert.deepEqual(h.calls[2], [
    "insert",
    {
      webhookEventId: "E1",
      lineUserId: "U1",
      ownerId: "password:c1",
      kind: "correction",
      text: "漢".repeat(500),
    },
    t0,
  ]);
});

test("a correction is saved and replied", async () => {
  const h = harness();
  await h.bot.handleEvent(textEvent("我去了学校"), deadline);
  assert.deepEqual(h.calls, [
    ["find", "U1"],
    ["ownerValid", "password:c1", "member"],
    [
      "insert",
      {
        webhookEventId: "E1",
        lineUserId: "U1",
        ownerId: "password:c1",
        kind: "correction",
        text: "我去了学校",
      },
      t0,
    ],
    ["startAttempt", "m1", t0],
    ["generate", "correction", "我去了学校"],
    ["recordUsage", "password:c1", usage],
    [
      "complete",
      "m1",
      "password:c1",
      { kind: "correction", originalText: "我去了学校", generation },
      t0,
    ],
    ["reply", "r1", [formatLineResult("correction", "我去了学校", generation)]],
  ]);
  assert.deepEqual(h.logs, []);

  const t = harness();
  await t.bot.handleEvent(textEvent("今日は雨"), deadline);
  assert.equal(t.calls[4][1], "translation");
  assert.deepEqual(t.calls.at(-1), [
    "reply",
    "r1",
    [formatLineResult("translation", "今日は雨", generation)],
  ]);
});

test("a redelivered event sends nothing", async () => {
  for (const status of ["done", "pending"] as const) {
    const h = harness({
      insert: () => ({ message: row("m1", 0, { status }), created: false }),
    });
    await h.bot.handleEvent(textEvent("我去了学校"), deadline);
    assert.deepEqual(h.names(), ["find", "ownerValid", "insert"]);
  }
});

test("an event without an id is skipped", async () => {
  const h = harness();
  await h.bot.handleEvent(
    textEvent("我去了学校", { webhookEventId: "" }),
    deadline,
  );
  assert.deepEqual(h.names(), ["find", "ownerValid"]);
  assert.deepEqual(h.logs, [["LINE_EVENT_WITHOUT_ID", undefined]]);
});

test("too little time left saves the text for the drain", async () => {
  let h = harness();
  h.setClock(deadline.getTime() - 29_999);
  await h.bot.handleEvent(textEvent("我去了学校"), deadline);
  assert.deepEqual(h.names(), ["find", "ownerValid", "insert", "reply"]);
  assert.deepEqual(h.calls.at(-1), ["reply", "r1", [LINE_REPLY.slow]]);
  assert.deepEqual(h.logs, [["LINE_MESSAGE_DEFERRED", { messageId: "m1" }]]);

  h = harness();
  h.setClock(deadline.getTime() - 30_000);
  await h.bot.handleEvent(textEvent("我去了学校"), deadline);
  assert.ok(h.names().includes("generate"));

  // A row that is no longer pending is left alone.
  h = harness({ startAttempt: () => null });
  await h.bot.handleEvent(textEvent("我去了学校"), deadline);
  assert.deepEqual(h.names(), ["find", "ownerValid", "insert", "startAttempt"]);
});

test("a retryable failure stays pending; others fail the message", async () => {
  let h = harness({
    generate: () => ({
      ok: false,
      failure: { code: "OPENAI_TIMEOUT", retryable: true },
    }),
  });
  await h.bot.handleEvent(textEvent("我去了学校"), deadline);
  assert.deepEqual(h.names().slice(4), ["generate", "recordUsage", "reply"]);
  assert.deepEqual(h.calls.at(-1), ["reply", "r1", [LINE_REPLY.slow]]);
  assert.deepEqual(h.logs, [
    ["LINE_GENERATION_RETRY", { messageId: "m1", code: "OPENAI_TIMEOUT" }],
  ]);

  const failed = {
    generate: () => ({
      ok: false,
      failure: { code: "OPENAI_RATE_LIMITED", retryable: false },
    }),
  };
  h = harness(failed);
  await h.bot.handleEvent(textEvent("我去了学校"), deadline);
  assert.deepEqual(h.calls.slice(4), [
    ["generate", "correction", "我去了学校"],
    ["recordUsage", "password:c1", usage],
    ["fail", "m1", t0],
    ["reply", "r1", [formatLineFailure("correction", "OPENAI_RATE_LIMITED")]],
  ]);
  assert.deepEqual(h.logs, [
    ["LINE_MESSAGE_FAILED", { messageId: "m1", code: "OPENAI_RATE_LIMITED" }],
  ]);

  h = harness({ ...failed, fail: boom });
  await assert.rejects(h.bot.handleEvent(textEvent("我去了学校"), deadline), {
    message: "boom",
  });
  assert.equal(h.names().includes("reply"), false);
});

test("a store failure after generating keeps the row pending", async () => {
  let h = harness({ complete: boom });
  await assert.rejects(h.bot.handleEvent(textEvent("我去了学校"), deadline), {
    message: "boom",
  });
  assert.deepEqual(h.calls.at(-1), ["reply", "r1", [LINE_REPLY.slow]]);

  // The store's failure wins over a failed reply.
  h = harness({
    complete: boom,
    reply: () => Promise.reject(new Error("reply")),
  });
  await assert.rejects(h.bot.handleEvent(textEvent("我去了学校"), deadline), {
    message: "boom",
  });

  h = harness({ complete: () => false });
  await h.bot.handleEvent(textEvent("我去了学校"), deadline);
  assert.equal(h.names().includes("reply"), false);
  assert.deepEqual(h.logs, [["LINE_MESSAGE_SETTLED", { messageId: "m1" }]]);
});

test("a reply failure is reported but changes nothing", async () => {
  const ok = harness();
  await ok.bot.handleEvent(textEvent("我去了学校"), deadline);
  const h = harness({ reply: () => Promise.reject(new Error("reply")) });
  await assert.rejects(h.bot.handleEvent(textEvent("我去了学校"), deadline), {
    message: "reply",
  });
  assert.deepEqual(h.calls, ok.calls);
  assert.deepEqual(h.logs, [["LINE_REPLY_FAILED", { eventId: "E1" }]]);
});

const drainDeadline = new Date(t0.getTime() + 50_000);

test("the drain finishes stale rows and pushes the result", async () => {
  const h = harness({ listStale: () => [row("m1", 1)] });
  await h.bot.runDailyPass(drainDeadline);
  assert.deepEqual(h.calls, [
    ["prune", t0],
    ["listStale", new Date(t0.getTime() - 300_000), 20],
    ["find", "U1"],
    ["ownerValid", "password:c1", "member"],
    ["startAttempt", "m1", t0],
    ["generate", "correction", "我去了学校"],
    ["recordUsage", "password:c1", usage],
    [
      "complete",
      "m1",
      "password:c1",
      { kind: "correction", originalText: "我去了学校", generation },
      t0,
    ],
    ["push", "U1", [formatLineResult("correction", "我去了学校", generation)]],
    ["reviewNotifyTargets", t0, 100],
  ]);
});

test("the drain fails what it cannot finish", async () => {
  for (const found of [null, { ...link, ownerId: "password:other" }]) {
    const h = harness({ listStale: () => [row("m1", 1)], find: () => found });
    await h.bot.runDailyPass(drainDeadline);
    assert.deepEqual(h.calls.slice(2, -1), [
      ["find", "U1"],
      ["fail", "m1", t0],
    ]);
    assert.deepEqual(h.logs.slice(0, 1), [
      ["LINE_MESSAGE_FAILED", { messageId: "m1", code: "LINK_GONE" }],
    ]);
  }

  let h = harness({ listStale: () => [row("m1", 1)], ownerValid: () => false });
  await h.bot.runDailyPass(drainDeadline);
  assert.deepEqual(h.calls.slice(2, -1), [
    ["find", "U1"],
    ["ownerValid", "password:c1", "member"],
    ["unlinkLineUser", "U1"],
    ["fail", "m1", t0],
    ["push", "U1", [LINE_REPLY.linkGone]],
  ]);

  h = harness({ listStale: () => [row("m1", 2)], startAttempt: () => null });
  await h.bot.runDailyPass(drainDeadline);
  assert.deepEqual(h.calls.slice(4, -1), [
    ["startAttempt", "m1", t0],
    ["fail", "m1", t0],
    ["push", "U1", [formatLineFailure("correction", "OPENAI_TIMEOUT")]],
  ]);

  h = harness({ listStale: () => [row("m1", 1)], startAttempt: () => null });
  await h.bot.runDailyPass(drainDeadline);
  assert.deepEqual(h.names().slice(4), ["startAttempt", "reviewNotifyTargets"]);

  h = harness({
    listStale: () => [row("m1", 1)],
    generate: () => ({
      ok: false,
      failure: { code: "OPENAI_TIMEOUT", retryable: true },
    }),
  });
  await h.bot.runDailyPass(drainDeadline);
  assert.deepEqual(h.calls.slice(5, -1), [
    ["generate", "correction", "我去了学校"],
    ["recordUsage", "password:c1", usage],
    ["fail", "m1", t0],
    ["push", "U1", [formatLineFailure("correction", "OPENAI_TIMEOUT")]],
  ]);

  // A settled row sends nothing; a store failure is reported after the pass.
  h = harness({ listStale: () => [row("m1", 1)], complete: () => false });
  await h.bot.runDailyPass(drainDeadline);
  assert.deepEqual(h.logs, [["LINE_MESSAGE_SETTLED", { messageId: "m1" }]]);
  assert.equal(h.names().includes("push"), false);

  h = harness({
    listStale: () => [row("m1", 1), row("m2", 1)],
    complete: boom,
  });
  await assert.rejects(h.bot.runDailyPass(drainDeadline), AggregateError);
  assert.equal(h.names().filter((n) => n === "complete").length, 2);
  assert.equal(h.names().includes("push"), false);
});

test("the drain skips rows it cannot finish in time but still fails exhausted ones", async () => {
  let h = harness({
    listStale: () => [row("m1", 0), row("m2", 2)],
    startAttempt: () => null,
  });
  h.setClock(drainDeadline.getTime() - 29_999);
  const now = new Date(drainDeadline.getTime() - 29_999);
  await h.bot.runDailyPass(drainDeadline);
  assert.deepEqual(h.calls.slice(2), [
    ["find", "U1"],
    ["ownerValid", "password:c1", "member"],
    ["startAttempt", "m2", now],
    ["fail", "m2", now],
    ["push", "U1", [formatLineFailure("correction", "OPENAI_TIMEOUT")]],
    ["reviewNotifyTargets", now, 100],
  ]);

  // Past the deadline, the next row is not started.
  const late = harness({
    listStale: () => [row("m1", 1), row("m2", 1)],
    push: () => late.setClock(drainDeadline.getTime()),
  });
  h = late;
  await h.bot.runDailyPass(drainDeadline);
  assert.equal(h.names().filter((n) => n === "find").length, 1);
});

function target(lineUserId: string, due: number): ReviewNotifyTarget {
  return { lineUserId, ownerId: `password:${lineUserId}`, role: "member", due };
}

test("the review message goes once, within the quota", async () => {
  let h = harness({
    reviewNotifyTargets: () => [
      target("Ua", 3),
      target("Ub", 4),
      target("Uc", 5),
    ],
    pushQuota: () => ({ unlimited: false, remaining: 32 }),
  });
  await h.bot.runDailyPass(drainDeadline);
  assert.deepEqual(h.calls.slice(2), [
    ["reviewNotifyTargets", t0, 100],
    ["pushQuota"],
    ["ownerValid", "password:Ua", "member"],
    ["claimReviewNotify", "Ua", t0],
    ["push", "Ua", [formatReviewReminder(3)]],
    ["ownerValid", "password:Ub", "member"],
    ["claimReviewNotify", "Ub", t0],
    ["push", "Ub", [formatReviewReminder(4)]],
  ]);
  assert.deepEqual(h.logs, [
    ["LINE_REVIEW_NOTIFY_LIMITED", { wanted: 3, allowed: 2 }],
    ["LINE_REVIEW_NOTIFY_SENT", { count: 2 }],
  ]);

  // An invalid owner is skipped; a lost claim sends nothing.
  h = harness({
    reviewNotifyTargets: () => [
      target("Ua", 3),
      target("Ub", 4),
      target("Uc", 5),
    ],
    ownerValid: (ownerId: string) => ownerId !== "password:Ua",
    claimReviewNotify: (lineUserId: string) => lineUserId !== "Ub",
  });
  await h.bot.runDailyPass(drainDeadline);
  assert.deepEqual(
    h.calls.filter((c) => c[0] === "push"),
    [["push", "Uc", [formatReviewReminder(5)]]],
  );
  assert.equal(h.names().includes("claimReviewNotify"), true);
  assert.deepEqual(
    h.calls.filter((c) => c[0] === "claimReviewNotify").map((c) => c[1]),
    ["Ub", "Uc"],
  );

  // Nobody due: the quota is not asked.
  h = harness();
  await h.bot.runDailyPass(drainDeadline);
  assert.equal(h.names().includes("pushQuota"), false);

  // The quota unknown: nothing is sent and the pass fails.
  h = harness({
    reviewNotifyTargets: () => [target("Ua", 3)],
    pushQuota: boom,
  });
  await assert.rejects(h.bot.runDailyPass(drainDeadline), AggregateError);
  assert.equal(h.names().includes("push"), false);
  assert.deepEqual(h.logs, [["LINE_REVIEW_NOTIFY_QUOTA_UNKNOWN", undefined]]);

  // A failed push goes on to the next target, then fails the pass.
  h = harness({
    reviewNotifyTargets: () => [target("Ua", 3), target("Ub", 4)],
    push: (to: string) => {
      if (to === "Ua") throw new Error("push");
    },
  });
  await assert.rejects(h.bot.runDailyPass(drainDeadline), AggregateError);
  assert.deepEqual(
    h.calls.filter((c) => c[0] === "push").map((c) => c[1]),
    ["Ua", "Ub"],
  );
  assert.deepEqual(h.logs, [
    ["LINE_REVIEW_NOTIFY_PUSH_FAILED", undefined],
    ["LINE_REVIEW_NOTIFY_SENT", { count: 1 }],
  ]);

  // Owner check and claim failures go on to the next target.
  h = harness({
    reviewNotifyTargets: () => [
      target("Ua", 3),
      target("Ub", 4),
      target("Uc", 5),
    ],
    ownerValid: (ownerId: string) => {
      if (ownerId === "password:Ua") throw new Error("owner");
      return true;
    },
    claimReviewNotify: (lineUserId: string) => {
      if (lineUserId === "Ub") throw new Error("claim");
      return true;
    },
  });
  await assert.rejects(h.bot.runDailyPass(drainDeadline), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    return true;
  });
  assert.deepEqual(
    h.calls.filter((c) => c[0] === "push").map((c) => c[1]),
    ["Uc"],
  );

  // Less than 3 s left: stop.
  h = harness({ reviewNotifyTargets: () => [target("Ua", 3)] });
  h.setClock(drainDeadline.getTime() - 2_999);
  await h.bot.runDailyPass(drainDeadline);
  assert.equal(h.names().includes("push"), false);
});

test("the daily pass sends the review message even when the drain failed", async () => {
  const h = harness({
    listStale: boom,
    reviewNotifyTargets: () => [target("Ua", 3)],
  });
  await assert.rejects(h.bot.runDailyPass(drainDeadline), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, "LINE_DAILY_PASS_FAILED");
    assert.equal(error.errors.length, 1);
    return true;
  });
  assert.deepEqual(
    h.calls.filter((c) => c[0] === "push").map((c) => c[1]),
    ["Ua"],
  );

  // A failed prune is reported, and the drain goes on.
  const p = harness({ prune: boom, listStale: () => [row("m1", 1)] });
  await assert.rejects(p.bot.runDailyPass(drainDeadline), AggregateError);
  assert.ok(p.names().includes("push"));
});

test("logs never carry text, ids or codes", () => {
  assert.ok(allLogs.length > 10);
  const logged = JSON.stringify(allLogs);
  for (const secret of [
    "我去了学校",
    "U1",
    "r1",
    "ABCD2345",
    "abcd2345",
    "password:c1",
    "我去学校了",
    "今日は雨",
  ])
    assert.equal(logged.includes(secret), false, secret);
});

test("owners are checked against the admin list or the member accounts", async () => {
  const asked: string[] = [];
  const check = createLineOwnerCheck({
    adminIds: new Set(["10001"]),
    async memberExists(ownerId) {
      asked.push(ownerId);
      return ownerId === "password:c1";
    },
  });
  assert.equal(await check("10001", "admin"), true);
  assert.equal(await check("10002", "admin"), false);
  assert.equal(await check("password:c1", "member"), true);
  assert.equal(await check("password:c2", "member"), false);
  assert.equal(await check("guest", "guest"), false);
  assert.equal(await check("10001", "revoked"), false);
  assert.deepEqual(asked, ["password:c1", "password:c2"]);
});
