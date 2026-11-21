import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createLearningNotes,
  LearningForbiddenError,
  type LearningNotesDeps,
} from "../src/application/learning/learning-notes";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import type { LearningEntry } from "../src/domain/learning/entities/learning-entry";
import type { EntrySearch } from "../src/domain/learning/entry-search";
import type { LearningCsvDraft } from "../src/domain/learning/learning-csv";
import {
  checkCsvFile,
  importFileName,
  parseLearningCsv,
} from "../src/infrastructure/csv/learning-csv";

const member: AuthenticatedUser = {
  githubLogin: "taro",
  githubId: "password:abc",
  role: "member",
  accountId: "abc",
};
const admin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "10001",
  role: "admin",
};
const actingAdmin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "password:abc",
  role: "admin",
  actingAs: { ownerId: "password:abc", loginId: "taro", displayName: "太郎" },
  actorId: "10001",
};
const demo: AuthenticatedUser = { ...member, demo: true };
const guest: AuthenticatedUser = { githubLogin: "g", role: "guest" };
const revoked: AuthenticatedUser = { ...member, role: "revoked" };
const noGithubId: AuthenticatedUser = { githubLogin: "x", role: "member" };

const entry: LearningEntry = {
  id: "e1",
  kind: "translation",
  originalText: "我去",
  correctedText: "我去了",
  pinyin: "wǒ qù le",
  createdAt: new Date("2026-11-16T00:00:00Z"),
  sharedAt: null,
  hints: [],
};
const date = { year: 2026, month: 11, day: 16 };
const search: EntrySearch = { query: "去", kind: null, hint: "" };

// Records every call to reads and writes with its arguments.
function setup(user: AuthenticatedUser | null) {
  const calls: unknown[][] = [];
  const record =
    <R>(name: string, result: R) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result;
    };
  const deps: LearningNotesDeps = {
    currentUser: async () => user,
    reads: {
      listRecent: record("listRecent", { entries: [entry], total: 1 }),
      listAll: record("listAll", [entry]),
      listLogDates: record("listLogDates", [{ date, count: 1 }]),
      listDailyEntries: record("listDailyEntries", [entry]),
      getDailyEntry: record("getDailyEntry", { entry, number: 1, total: 3 }),
      listTrashed: record("listTrashed", { entries: [], total: 0 }),
    },
    writes: {
      trash: record("trash", true),
      restore: record("restore", true),
      purge: record("purge", true),
      emptyTrash: record("emptyTrash", 2),
      setShared: record("setShared", true),
    },
    csvImport: {
      checkFile: checkCsvFile,
      parse: parseLearningCsv,
      fileName: importFileName,
      importBatch: async (
        ownerId: string,
        fileName: string,
        drafts: LearningCsvDraft[],
      ) => {
        calls.push(["importBatch", ownerId, fileName, drafts]);
        return drafts.length;
      },
    },
  };
  return { notes: createLearningNotes(deps), calls, deps };
}

const self = (ownerId: string) => ({ kind: "self", ownerId }) as const;
const other = { kind: "other", ownerId: "password:other" } as const;

test("reads the viewed owner", async () => {
  const { notes, calls } = setup(member);
  assert.deepEqual(await notes.listRecent(self("password:abc"), 100), {
    entries: [entry],
    total: 1,
  });
  await notes.listRecent(self("password:abc"), 50, search);
  await notes.listLogDates(self("password:abc"));
  await notes.listDailyEntries(self("password:abc"), date);
  assert.deepEqual(await notes.getDailyEntry(self("password:abc"), date, 1), {
    entry,
    total: 3,
  });
  await notes.listAll();
  await notes.listTrashed();
  assert.deepEqual(calls, [
    ["listRecent", "password:abc", 100, undefined],
    ["listRecent", "password:abc", 50, search],
    ["listLogDates", "password:abc"],
    ["listDailyEntries", "password:abc", date],
    ["getDailyEntry", "password:abc", date, 1],
    ["listAll", "password:abc"],
    ["listTrashed", "password:abc"],
  ]);
});

test("reading one's own notes uses the signed-in owner, not the page's id", async () => {
  const { notes, calls } = setup(member);
  await notes.listLogDates(self("password:someone-else"));
  assert.deepEqual(calls, [["listLogDates", "password:abc"]]);
});

test("getDailyEntry is null when the day has no such note", async () => {
  const { notes, deps } = setup(member);
  deps.reads.getDailyEntry = async () => null;
  assert.equal(await notes.getDailyEntry(self("password:abc"), date, 9), null);
});

test("only admins read another owner", async () => {
  for (const user of [member, demo]) {
    const { notes, calls } = setup(user);
    for (const read of [
      () => notes.listRecent(other, 100),
      () => notes.listLogDates(other),
      () => notes.listDailyEntries(other, date),
      () => notes.getDailyEntry(other, date, 1),
    ])
      await assert.rejects(read(), LearningForbiddenError);
    assert.deepEqual(calls, []);
  }

  const { notes, calls } = setup(admin);
  await notes.listRecent(other, 100);
  await notes.listLogDates(other);
  await notes.listDailyEntries(other, date);
  await notes.getDailyEntry(other, date, 2);
  assert.deepEqual(calls, [
    ["listRecent", "password:other", 100, undefined],
    ["listLogDates", "password:other"],
    ["listDailyEntries", "password:other", date],
    ["getDailyEntry", "password:other", date, 2],
  ]);
});

test("writes always use the signed-in owner", async () => {
  const { notes, calls } = setup(actingAdmin);
  assert.equal(await notes.trash("e1"), true);
  assert.equal(await notes.restore("e2"), true);
  assert.equal(await notes.purge("e3"), true);
  assert.equal(await notes.emptyTrash(), 2);
  assert.deepEqual(calls, [
    ["trash", "password:abc", "e1"],
    ["restore", "password:abc", "e2"],
    ["purge", "password:abc", "e3"],
    ["emptyTrash", "password:abc"],
  ]);
});

test("refuses without a member or admin", async () => {
  for (const user of [null, guest, revoked, noGithubId]) {
    const { notes, calls } = setup(user);
    for (const run of [
      () => notes.listRecent(self("password:abc"), 100),
      () => notes.listRecent(other, 100),
      () => notes.listAll(),
      () => notes.listLogDates(self("password:abc")),
      () => notes.listDailyEntries(self("password:abc"), date),
      () => notes.getDailyEntry(self("password:abc"), date, 1),
      () => notes.listTrashed(),
      () => notes.trash("e1"),
      () => notes.restore("e1"),
      () => notes.purge("e1"),
      () => notes.emptyTrash(),
      () => notes.setShared("e1", true),
    ])
      await assert.rejects(run(), LearningForbiddenError, String(user?.role));
    assert.deepEqual(calls, []);
  }
});

test("only plain members may share", async () => {
  const { notes, calls } = setup(member);
  assert.equal(await notes.setShared("e1", true), true);
  assert.equal(await notes.setShared("e1", false), true);
  assert.deepEqual(calls, [
    ["setShared", "password:abc", "e1", true],
    ["setShared", "password:abc", "e1", false],
  ]);

  for (const user of [admin, actingAdmin, demo]) {
    const { notes, calls } = setup(user);
    for (const shared of [true, false])
      await assert.rejects(
        notes.setShared("e1", shared),
        LearningForbiddenError,
      );
    assert.deepEqual(calls, []);
  }
});

const csv = (text: string, name = "notes.csv") => new File([text], name);
const twoRows =
  "最初の文,添削後の文,ピン音\n我好,我很好,wo hen hao,提示\n去,去了,qu le";
const twoDrafts: LearningCsvDraft[] = [
  {
    originalText: "我好",
    correctedText: "我很好",
    pinyin: "wo hen hao",
    hints: ["提示"],
  },
  { originalText: "去", correctedText: "去了", pinyin: "qu le", hints: [] },
];

test("imports into the signed-in owner only", async () => {
  for (const [user, ownerId] of [
    [member, "password:abc"],
    [actingAdmin, "password:abc"],
    [demo, "password:abc"],
  ] as const) {
    const { notes, calls } = setup(user);
    assert.deepEqual(await notes.importCsv(csv(twoRows)), {
      ok: true,
      count: 2,
    });
    assert.deepEqual(calls, [["importBatch", ownerId, "notes.csv", twoDrafts]]);
  }

  for (const user of [null, guest, revoked, noGithubId]) {
    const { notes, calls } = setup(user);
    await assert.rejects(
      notes.importCsv(csv(twoRows)),
      LearningForbiddenError,
      String(user?.role),
    );
    assert.deepEqual(calls, []);
  }
});

test("returns the CSV's problem without writing", async () => {
  const { notes, calls } = setup(member);
  assert.deepEqual(await notes.importCsv(csv("我好,我很好")), {
    ok: false,
    message: "1行目は3列未満です。",
  });
  assert.deepEqual(await notes.importCsv(csv(twoRows, "a.txt")), {
    ok: false,
    message: "拡張子が.csvのファイルを選択してください。",
  });
  assert.deepEqual(await notes.importCsv(csv("")), {
    ok: false,
    message: "CSVファイルを選択してください。",
  });
  // Too large: the file is never read.
  const big = {
    name: "big.txt",
    size: 4 * 1024 * 1024 + 1,
    text: () => assert.fail("read a file that is too large"),
  };
  assert.deepEqual(await notes.importCsv(big), {
    ok: false,
    message: "ファイルは4MB以下にしてください。",
  });
  // The file name is checked after the contents.
  assert.deepEqual(await notes.importCsv(csv("我好,我很好", "a\0.csv")), {
    ok: false,
    message: "1行目は3列未満です。",
  });
  assert.deepEqual(await notes.importCsv(csv(twoRows, "a\0.csv")), {
    ok: false,
    message:
      "CSVの形式を確認してください。引用符が閉じていないか、1行が長すぎる可能性があります。",
  });
  assert.deepEqual(calls, []);
});

test("passes the cut file name and the drafts", async () => {
  const { notes, calls } = setup(member);
  const name = "a".repeat(296) + ".csv";
  assert.equal(name.length, 300);
  assert.deepEqual(await notes.importCsv(csv(twoRows, name)), {
    ok: true,
    count: 2,
  });
  assert.deepEqual(calls, [
    ["importBatch", "password:abc", name.slice(0, 255), twoDrafts],
  ]);
});

test("lets a failed write through", async () => {
  const { notes, deps } = setup(member);
  const failure = new Error("db down");
  deps.csvImport.importBatch = async () => {
    throw failure;
  };
  await assert.rejects(notes.importCsv(csv(twoRows)), (e) => e === failure);
});
