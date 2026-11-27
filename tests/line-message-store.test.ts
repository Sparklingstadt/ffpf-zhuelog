import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "../src/generated/prisma/client";
import {
  createLineMessageStore,
  insertLineMessageSql,
  startAttemptSql,
} from "../src/infrastructure/prisma/line-message-store";

const now = new Date("2026-11-17T21:00:00.000Z");

const flat = (text: string) => text.replace(/\s+/g, " ");

const message = {
  webhookEventId: "E1",
  lineUserId: "U1",
  userId: "u1",
  kind: "correction" as const,
  text: "你好",
};

test("insertLineMessageSql ignores a second delivery", () => {
  const sql = insertLineMessageSql("cid", message, now);
  const text = flat(sql.text);
  for (const part of [
    "'pending', 0, CAST($7 AS TIMESTAMP(3)), CAST($8 AS TIMESTAMP(3))",
    'ON CONFLICT ("webhookEventId") DO NOTHING',
    "RETURNING",
    `COALESCE("text", '')`,
  ]) {
    assert.ok(text.includes(part), text);
  }
  assert.deepEqual(sql.values, [
    "cid",
    "E1",
    "U1",
    "u1",
    "correction",
    "你好",
    now,
    now,
  ]);
});

test("startAttemptSql allows two attempts", () => {
  const sql = startAttemptSql("cid", now);
  const text = flat(sql.text);
  for (const part of [
    '"attempts" = "attempts" + 1',
    `"status" = 'pending' AND "attempts" < $3`,
  ]) {
    assert.ok(text.includes(part), text);
  }
  assert.deepEqual(sql.values, [now, "cid", 2]);
});

function fakeCompleteDb(count: number) {
  const calls: Record<string, unknown[]> = {
    importBatch: [],
    learningEntry: [],
    hint: [],
    lineMessage: [],
  };
  const options: unknown[] = [];
  let threw: unknown = null;
  const tx = {
    importBatch: {
      create: async (args: unknown) => calls.importBatch.push(args),
    },
    learningEntry: {
      create: async (args: unknown) => calls.learningEntry.push(args),
    },
    hint: { createMany: async (args: unknown) => calls.hint.push(args) },
    lineMessage: {
      updateMany: async (args: unknown) => {
        calls.lineMessage.push(args);
        return { count };
      },
    },
  };
  const db = {
    $transaction: async (
      run: (t: typeof tx) => Promise<unknown>,
      opts: unknown,
    ) => {
      options.push(opts);
      try {
        return await run(tx);
      } catch (error) {
        threw = error;
        throw error;
      }
    },
  } as unknown as PrismaClient;
  return { db, calls, options, threw: () => threw };
}

test("complete saves the note and settles the message together", async () => {
  const note = {
    kind: "correction" as const,
    originalText: "我去了学校昨天",
    generation: {
      text: "我昨天去了学校",
      pinyin: "wǒ zuótiān qù le xuéxiào",
      hints: ["时间词放在动词前", "了 表示完成"],
    },
  };
  {
    const fake = fakeCompleteDb(1);
    const store = createLineMessageStore(() => fake.db);
    assert.equal(await store.complete("cid", "u1", note, now), true);
    assert.deepEqual(fake.options, [{ maxWait: 5000, timeout: 15000 }]);
    assert.equal(fake.threw(), null);

    const batch = (
      fake.calls.importBatch[0] as { data: Record<string, unknown> }
    ).data;
    assert.equal(batch.fileName, "LINE");
    assert.equal(batch.rowCount, 1);
    assert.equal(batch.importedAt, now);
    assert.equal(typeof batch.id, "string");

    const entry = (
      fake.calls.learningEntry[0] as { data: Record<string, unknown> }
    ).data;
    assert.deepEqual(entry, {
      id: entry.id,
      kind: "correction",
      originalText: "我去了学校昨天",
      correctedText: "我昨天去了学校",
      pinyin: "wǒ zuótiān qù le xuéxiào",
      createdAt: now,
      userId: "u1",
      batchId: batch.id,
    });

    const hints = (
      fake.calls.hint[0] as {
        data: { content: string; position: number; learningEntryId: string }[];
      }
    ).data;
    assert.deepEqual(
      hints.map((h) => [h.content, h.position, h.learningEntryId]),
      [
        ["时间词放在动词前", 0, entry.id],
        ["了 表示完成", 1, entry.id],
      ],
    );

    assert.deepEqual(fake.calls.lineMessage, [
      {
        where: { id: "cid", userId: "u1", status: "pending" },
        data: { status: "done", entryId: entry.id, text: null, updatedAt: now },
      },
    ]);
  }
  {
    const fake = fakeCompleteDb(0);
    const store = createLineMessageStore(() => fake.db);
    assert.equal(await store.complete("cid", "u1", note, now), false);
    assert.ok(fake.threw() instanceof Error, "the transaction rolls back");
  }
  {
    const fake = fakeCompleteDb(1);
    const store = createLineMessageStore(() => fake.db);
    const noHints = { ...note, generation: { ...note.generation, hints: [] } };
    assert.equal(await store.complete("cid", "u1", noHints, now), true);
    assert.deepEqual(fake.calls.hint, []);
  }
});

test("a second delivery returns the stored row", async () => {
  const stored = {
    id: "cold",
    webhookEventId: "E1",
    lineUserId: "U1",
    userId: "u1",
    kind: "translation",
    text: null,
    status: "done",
    attempts: 1,
    entryId: "e1",
    createdAt: now,
    updatedAt: now,
  };
  const finds: unknown[] = [];
  const db = {
    $queryRaw: async () => [],
    lineMessage: {
      findUnique: async (args: unknown) => {
        finds.push(args);
        return stored;
      },
    },
  } as unknown as PrismaClient;
  const store = createLineMessageStore(
    () => db,
    () => "cnew",
  );
  const result = await store.insert(message, now);
  assert.equal(result.created, false);
  assert.equal(result.message.text, "");
  assert.deepEqual(result.message, {
    id: "cold",
    webhookEventId: "E1",
    lineUserId: "U1",
    ownerId: "u1",
    kind: "translation",
    text: "",
    status: "done",
    attempts: 1,
    createdAt: now,
  });
  assert.deepEqual(finds, [{ where: { webhookEventId: "E1" } }]);
});

test("a first delivery inserts with the new id", async () => {
  const row = {
    id: "cnew",
    webhookEventId: "E1",
    lineUserId: "U1",
    userId: "u1",
    kind: "correction",
    text: "你好",
    status: "pending",
    attempts: 0,
    createdAt: now,
  };
  const queries: unknown[][] = [];
  const db = {
    $queryRaw: async (sql: { values: unknown[] }) => {
      queries.push(sql.values);
      return [row];
    },
  } as unknown as PrismaClient;
  const store = createLineMessageStore(
    () => db,
    () => "cnew",
  );
  const { userId, ...rest } = row;
  assert.deepEqual(await store.insert(message, now), {
    message: { ...rest, ownerId: userId },
    created: true,
  });
  assert.equal(queries[0][0], "cnew");
});

// Records each Prisma model call as [model.method, args].
function fakeModelDb(results: Record<string, unknown> = {}) {
  const calls: [string, unknown][] = [];
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_, method: string) => async (args: unknown) => {
          calls.push([`${name}.${method}`, args]);
          return results[`${name}.${method}`] ?? { count: 0 };
        },
      },
    );
  const db = {
    lineMessage: model("lineMessage"),
    lineLinkCode: model("lineLinkCode"),
  } as unknown as PrismaClient;
  return { db, calls };
}

test("fail settles only a pending message and clears its text", async () => {
  const { db, calls } = fakeModelDb();
  await createLineMessageStore(() => db).fail("cid", now);
  assert.deepEqual(calls, [
    [
      "lineMessage.updateMany",
      {
        where: { id: "cid", status: "pending" },
        data: { status: "failed", text: null, updatedAt: now },
      },
    ],
  ]);
});

test("listStale reads the oldest pending messages first, up to the limit", async () => {
  const before = new Date("2026-11-17T20:58:00.000Z");
  const { db, calls } = fakeModelDb({ "lineMessage.findMany": [] });
  assert.deepEqual(
    await createLineMessageStore(() => db).listStale(before, 20),
    [],
  );
  assert.deepEqual(calls, [
    [
      "lineMessage.findMany",
      {
        where: { status: "pending", createdAt: { lt: before } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 20,
      },
    ],
  ]);
});

test("prune drops settled messages older than 7 days and expired codes", async () => {
  const { db, calls } = fakeModelDb();
  await createLineMessageStore(() => db).prune(now);
  assert.deepEqual(calls, [
    [
      "lineMessage.deleteMany",
      {
        where: {
          status: { in: ["done", "failed"] },
          updatedAt: { lt: new Date("2026-11-10T21:00:00.000Z") },
        },
      },
    ],
    ["lineLinkCode.deleteMany", { where: { expiresAt: { lte: now } } }],
  ]);
});
