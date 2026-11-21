import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AiUsageForbiddenError,
  createAiUsageSummary,
  type AiUsageSummaryDeps,
} from "../src/application/ai-usage/ai-usage-summary";
import type { AiUsageTotal } from "../src/domain/ai-usage/monthly-usage";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";

const member: AuthenticatedUser = {
  githubLogin: "taro",
  githubId: "password:abc",
  role: "member",
  accountId: "abc",
};
const actingAdmin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "password:abc",
  role: "admin",
  actingAs: { ownerId: "password:abc", loginId: "taro", displayName: "太郎" },
  actorId: "10001",
};
const admin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "10001",
  role: "admin",
};
const demo: AuthenticatedUser = {
  githubLogin: "demo",
  githubId: "demo:1",
  role: "member",
  demo: true,
};
const guest: AuthenticatedUser = {
  githubLogin: "guest",
  githubId: "guest",
  role: "guest",
};

const totals: AiUsageTotal[] = [
  {
    ownerId: "password:abc",
    displayName: "太郎",
    feature: "line",
    model: "gpt-5-mini",
    requests: 2,
    inputTokens: 100,
    outputTokens: 50,
  },
];

function summary(
  user: AuthenticatedUser | null,
  answer: AiUsageTotal[] = totals,
  now = new Date("2026-10-31T15:00:00.000Z"),
) {
  const calls: [Date, Date][] = [];
  let nows = 0;
  const deps: AiUsageSummaryDeps = {
    currentUser: async () => user,
    store: {
      async monthTotals(from, to) {
        calls.push([from, to]);
        return answer;
      },
    },
    now: () => {
      nows++;
      return now;
    },
  };
  return { usage: createAiUsageSummary(deps), calls, nows: () => nows };
}

test("only admins read the AI usage", async () => {
  for (const user of [admin, actingAdmin]) {
    const { usage, calls } = summary(user);
    assert.equal((await usage.month("2026-09")).totals, totals);
    assert.equal(calls.length, 1);
  }
  for (const user of [member, demo, guest, null]) {
    const { usage, calls } = summary(user);
    await assert.rejects(usage.month("2026-09"), AiUsageForbiddenError);
    assert.equal(calls.length, 0);
  }
});

test("a month is read as Japan time", async () => {
  const given = summary(admin);
  assert.deepEqual(await given.usage.month("2026-09"), {
    month: "2026-09",
    totals,
  });
  assert.deepEqual(given.calls, [
    [
      new Date("2026-08-31T15:00:00.000Z"),
      new Date("2026-09-30T15:00:00.000Z"),
    ],
  ]);

  const current = summary(admin, []);
  assert.deepEqual(await current.usage.month(), {
    month: "2026-11",
    totals: [],
  });
  assert.deepEqual(current.calls, [
    [
      new Date("2026-10-31T15:00:00.000Z"),
      new Date("2026-11-30T15:00:00.000Z"),
    ],
  ]);
  assert.equal(current.nows(), 1);
});

test("a bad month never reaches the store", async () => {
  // Go: TestAIUsageSummaryRejectsABadMonth.
  for (const bad of [
    "2026-13",
    "2026-00",
    "2026-1",
    "202611",
    "1999-12",
    "x",
  ]) {
    const { usage, calls } = summary(admin);
    await assert.rejects(usage.month(bad), RangeError, bad);
    assert.equal(calls.length, 0);
  }
});
