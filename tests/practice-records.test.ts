import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPracticeRecords,
  PracticeForbiddenError,
  type PracticeRecordsDeps,
} from "../src/application/practice/practice-records";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import type {
  ComplementRecord,
  ComplementRecordSummary,
} from "../src/domain/practice/complement-record";
import type {
  PracticeRecord,
  PracticeRecordSummary,
} from "../src/domain/practice/practice-record";
import type {
  ComplementRound,
  PracticeRound,
} from "../src/domain/practice/practice-round";

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
const demo: AuthenticatedUser = {
  githubLogin: "demo",
  githubId: "demo:1",
  role: "member",
  demo: true,
};
const guest: AuthenticatedUser = { githubLogin: "g", role: "guest" };
const revoked: AuthenticatedUser = { ...member, role: "revoked" };
const noGithubId: AuthenticatedUser = { githubLogin: "x", role: "member" };

const now = new Date("2026-11-16T03:00:00.000Z");
const id = "0b7e3f5a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const round: PracticeRound = {
  id,
  startedAt: new Date("2026-11-16T02:55:00.000Z"),
  elapsedMs: 300_000,
  questions: [
    {
      id: "P001",
      answer: "在",
      noun: "学校",
      prompt: "（　）学校",
      misses: [],
    },
    {
      id: "P002",
      answer: "给",
      noun: "妈妈",
      prompt: "（　）妈妈",
      misses: ["对", "跟"],
    },
  ],
};
const complementRound: ComplementRound = { ...round, mode: "result" };
// Two misses that are the same choice: Go refused it.
const badRound: PracticeRound = {
  ...round,
  questions: [{ ...round.questions[0], misses: ["对", "对"] }],
};

const summary: PracticeRecordSummary = {
  id,
  questionCount: 2,
  firstTryCount: 1,
  missCount: 2,
  elapsedMs: 300_000,
  startedAt: round.startedAt,
  createdAt: now,
};
const record: PracticeRecord = { ...summary, questions: [...round.questions] };
const complementSummary: ComplementRecordSummary = {
  ...summary,
  mode: "result",
};
const complementRecord: ComplementRecord = { ...record, mode: "result" };

// Records every store call with its arguments.
function setup(
  user: AuthenticatedUser | null,
  saved: { preposition: unknown; complement: unknown } = {
    preposition: record,
    complement: complementRecord,
  },
) {
  const calls: unknown[][] = [];
  const record_ =
    <R>(name: string, result: R) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result;
    };
  const deps: PracticeRecordsDeps = {
    currentUser: async () => user,
    store: {
      listPrepositions: record_("listPrepositions", [summary]),
      listComplements: record_("listComplements", [complementSummary]),
      getPreposition: record_("getPreposition", record),
      getComplement: record_("getComplement", complementRecord),
      savePreposition: record_(
        "savePreposition",
        saved.preposition as PracticeRecord | null,
      ),
      saveComplement: record_(
        "saveComplement",
        saved.complement as ComplementRecord | null,
      ),
    },
    now: () => now,
  };
  return { records: createPracticeRecords(deps), calls };
}

test("practice records follow the signed-in owner", async () => {
  for (const [user, owner] of [
    [member, "password:abc"],
    [actingAdmin, "password:abc"],
    [demo, "demo:1"],
  ] as const) {
    const { records, calls } = setup(user);
    await records.prepositions.list();
    await records.complements.list();
    await records.prepositions.get(id);
    await records.complements.get(id);
    assert.equal(await records.prepositions.save(round), "saved");
    assert.equal(await records.complements.save(complementRound), "saved");
    assert.deepEqual(
      calls.map(([name, ownerId]) => [name, ownerId]),
      [
        ["listPrepositions", owner],
        ["listComplements", owner],
        ["getPreposition", owner],
        ["getComplement", owner],
        ["savePreposition", owner],
        ["saveComplement", owner],
      ],
    );
  }
});

test("without an owner every method is forbidden before any check", async () => {
  for (const user of [null, guest, revoked, noGithubId]) {
    const { records, calls } = setup(user);
    for (const run of [
      () => records.prepositions.list(),
      () => records.complements.list(),
      () => records.prepositions.get(id),
      () => records.complements.get("not-a-uuid"),
      () => records.prepositions.save(round),
      () => records.prepositions.save(badRound),
      () => records.complements.save({ ...complementRound, elapsedMs: -1 }),
    ])
      await assert.rejects(run, PracticeForbiddenError);
    assert.deepEqual(calls, []);
  }
});

test("list reads the newest 100 rounds", async () => {
  const { records, calls } = setup(member);
  assert.deepEqual(await records.prepositions.list(), [summary]);
  assert.deepEqual(await records.complements.list(), [complementSummary]);
  assert.deepEqual(calls, [
    ["listPrepositions", "password:abc", 100],
    ["listComplements", "password:abc", 100],
  ]);
});

test("get of an id of the wrong shape is null without asking the store", async () => {
  const { records, calls } = setup(member);
  for (const bad of ["not-a-uuid", id.toUpperCase()]) {
    assert.equal(await records.prepositions.get(bad), null);
    assert.equal(await records.complements.get(bad), null);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await records.prepositions.get(id), record);
  assert.deepEqual(await records.complements.get(id), complementRecord);
  assert.deepEqual(calls, [
    ["getPreposition", "password:abc", id],
    ["getComplement", "password:abc", id],
  ]);
});

test("save checks the round before the store and passes one now", async () => {
  const invalid = setup(member);
  assert.equal(await invalid.records.prepositions.save(badRound), "invalid");
  assert.equal(
    await invalid.records.complements.save({
      ...badRound,
      mode: "result",
    }),
    "invalid",
  );
  assert.equal(
    await invalid.records.complements.save({
      ...round,
      mode: "nope",
    } as unknown as ComplementRound),
    "invalid",
  );
  assert.deepEqual(invalid.calls, []);

  const taken = setup(member, { preposition: null, complement: null });
  assert.equal(await taken.records.prepositions.save(round), "taken");
  assert.equal(await taken.records.complements.save(complementRound), "taken");

  const { records, calls } = setup(member);
  assert.equal(await records.prepositions.save(round), "saved");
  assert.equal(await records.complements.save(complementRound), "saved");
  const checked = {
    id,
    startedAt: round.startedAt,
    elapsedMs: 300_000,
    questions: round.questions,
    questionCount: 2,
    firstTryCount: 1,
    missCount: 2,
  };
  assert.deepEqual(calls, [
    ["savePreposition", "password:abc", checked, now],
    ["saveComplement", "password:abc", { ...checked, mode: "result" }, now],
  ]);
});
