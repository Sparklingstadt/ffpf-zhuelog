import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createStudyLogReader,
  StudyLogForbiddenError,
  type StudyLogReaderDeps,
} from "../src/application/study-log/study-log-reader";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import type { StudyDay } from "../src/domain/study-log/study-log";

const member: AuthenticatedUser = {
  userId: "abc",
  role: "member",
  displayName: "taro",
  username: "taro",
};
const impersonated: AuthenticatedUser = {
  userId: "abc",
  role: "member",
  displayName: "太郎",
  username: "taro",
  impersonatedBy: "10001",
};
const admin: AuthenticatedUser = {
  userId: "10001",
  role: "admin",
  displayName: "octocat",
};
const demo: AuthenticatedUser = {
  userId: "demo1",
  role: "member",
  displayName: "demo",
  demo: true,
};
const guest: AuthenticatedUser = {
  userId: "guest",
  role: "guest",
  displayName: "guest",
};

const days: StudyDay[] = [
  { date: "2026-11-01", reviews: 3, practiceQuestions: 10, notes: 1, words: 2 },
];

function reader(user: AuthenticatedUser | null) {
  const calls: [string, Date, Date][] = [];
  const deps: StudyLogReaderDeps = {
    currentUser: async () => user,
    store: {
      async days(ownerId, start, end) {
        calls.push([ownerId, start, end]);
        return days;
      },
    },
  };
  return { log: createStudyLogReader(deps), calls };
}

test("the study log is the signed-in owner's", async () => {
  const { log, calls } = reader(member);
  assert.equal(await log.list("2026-10-27", "2026-12-06"), days);
  assert.deepEqual(calls, [
    [
      "abc",
      new Date("2026-10-26T15:00:00.000Z"),
      new Date("2026-12-06T15:00:00.000Z"),
    ],
  ]);

  for (const [user, owner] of [
    [impersonated, "abc"],
    [admin, "10001"],
    [demo, "demo1"],
  ] as const) {
    const r = reader(user);
    await r.log.list("2026-11-01", "2026-11-30");
    assert.equal(r.calls[0][0], owner);
  }
});

test("others have no study log", async () => {
  for (const user of [null, guest]) {
    const { log, calls } = reader(user);
    await assert.rejects(
      log.list("2026-11-01", "2026-11-30"),
      StudyLogForbiddenError,
    );
    assert.equal(calls.length, 0);
  }
  // Who comes first: a guest with a bad range is still refused as a guest.
  const { log, calls } = reader(guest);
  await assert.rejects(
    log.list("2026-11-1", "2026-11-30"),
    StudyLogForbiddenError,
  );
  assert.equal(calls.length, 0);
});

test("a malformed or too-long range never reaches the store", async () => {
  const { log, calls } = reader(member);
  await assert.rejects(log.list("2026-01-01", "2026-04-04"), RangeError);
  await assert.rejects(log.list("2026-11-1", "2026-11-30"), RangeError);
  assert.equal(calls.length, 0);
});
