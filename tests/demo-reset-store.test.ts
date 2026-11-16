import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { DemoSeed } from "../src/domain/demo/demo-seed";
import type { FsrsCard } from "../src/domain/review/fsrs";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  createDemoResetStore,
  DEMO_KEPT_TABLES,
  DEMO_OWNED_TABLES,
  DEMO_RESET_TRANSACTION_OPTIONS,
  demoSeedRows,
} from "../src/infrastructure/prisma/demo-reset-store";

const flat = (text: string) => text.replace(/\s+/g, " ");

// Go: TestDemoResetCoversEveryOwnerTable (store/review_orphans_test.go), read
// from the schema rather than a migrated database. It only sees columns named
// ownerId: a table that ties a row to its owner through another column (as
// Follow does with followerId and followeeId) must be added to the reset by
// hand. Go's test had the same limit.
test("every owner table is emptied or kept on purpose", () => {
  const schema = readFileSync(
    join(import.meta.dirname, "..", "prisma", "schema.prisma"),
    "utf8",
  );
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(
    ([, name, body]) => ({ name, owned: /^\s+ownerId\s/m.test(body) }),
  );
  assert.ok(models.length > 0, "no models in prisma/schema.prisma");
  const ownerTables = models.filter((m) => m.owned).map((m) => m.name);
  const kept = Object.keys(DEMO_KEPT_TABLES);

  for (const table of ownerTables) {
    assert.ok(
      DEMO_OWNED_TABLES.includes(table) || kept.includes(table),
      `table ${table} has an ownerId column but the demo reset does not delete its rows: ` +
        "add it to DEMO_OWNED_TABLES in src/infrastructure/prisma/demo-reset-store.ts " +
        "(or, if the reset must keep it, to DEMO_KEPT_TABLES with the reason)",
    );
  }
  for (const table of [...DEMO_OWNED_TABLES, ...kept]) {
    assert.ok(
      ownerTables.includes(table),
      `table ${table} is listed for the demo reset but has no ownerId column`,
    );
  }
  assert.deepEqual(
    DEMO_OWNED_TABLES.filter((t) => kept.includes(t)),
    [],
    "a table is both emptied and kept",
  );
});

type Call = { model: string; method: string; args: unknown[] };

// A fake client whose transaction records every call. The SELECT ... FOR
// UPDATE answers with the demo account's id.
function fakeDb(accountId = "cdemo") {
  const calls: Call[] = [];
  let options: unknown;
  const tx = new Proxy(
    {},
    {
      get(_, model: string) {
        if (model === "$executeRaw" || model === "$queryRaw")
          return async (...args: unknown[]) => {
            calls.push({ model: "$raw", method: model, args });
            return model === "$queryRaw" ? [{ id: accountId }] : 1;
          };
        return new Proxy(
          {},
          {
            get(__, method: string) {
              return async (...args: unknown[]) => {
                calls.push({ model, method, args });
                return { count: 0 };
              };
            },
          },
        );
      },
    },
  );
  const db = {
    $transaction: async (
      run: (t: unknown) => Promise<unknown>,
      opts: unknown,
    ) => {
      options = opts;
      return run(tx);
    },
  } as unknown as PrismaClient;
  return { db, calls, options: () => options };
}

const emptySeed: DemoSeed = {
  displayName: "デモ",
  notes: [],
  words: [],
  conversations: [],
  prepositionRecords: [],
  complementRecords: [],
};

const now = new Date("2026-11-10T19:00:00.000Z");

test("the reset empties exactly those tables, in one transaction", async () => {
  const { db, calls, options } = fakeDb();
  const store = createDemoResetStore(
    () => db,
    () => "cnew",
  );

  assert.equal(await store.reset("demo", emptySeed, now), "cdemo");
  assert.deepEqual(options(), { maxWait: 5000, timeout: 20000 });
  assert.deepEqual(DEMO_RESET_TRANSACTION_OPTIONS, {
    maxWait: 5000,
    timeout: 20000,
  });

  const raw = calls.filter((c) => c.model === "$raw");
  const sqlOf = (c: Call) => c.args[0] as { text: string; values: unknown[] };
  const [insert, select, batches] = raw.map(sqlOf);
  assert.equal(raw.length, 3);
  assert.ok(
    flat(insert.text).includes('ON CONFLICT ("loginId") DO NOTHING'),
    insert.text,
  );
  assert.ok(flat(select.text).includes("FOR UPDATE"), select.text);
  assert.ok(
    flat(batches.text).includes(
      'DELETE FROM "ImportBatch" WHERE "id" IN (SELECT "batchId" FROM "LearningEntry" WHERE "ownerId" =',
    ),
    batches.text,
  );
  assert.deepEqual(batches.values, ["password:cdemo"]);

  const lower = (name: string) => name[0].toLowerCase() + name.slice(1);
  const deletes = calls.filter((c) => c.method === "deleteMany");
  assert.deepEqual(
    deletes.filter((c) => c.model !== "follow"),
    DEMO_OWNED_TABLES.map((table) => ({
      model: lower(table),
      method: "deleteMany",
      args: [{ where: { ownerId: "password:cdemo" } }],
    })),
  );
  assert.deepEqual(
    deletes.filter((c) => c.model === "follow"),
    [
      {
        model: "follow",
        method: "deleteMany",
        args: [
          {
            where: {
              OR: [
                { followerId: "password:cdemo" },
                { followeeId: "password:cdemo" },
              ],
            },
          },
        ],
      },
    ],
  );
  for (const model of ["aiUsage", "apiRefreshToken", "passwordAccount"])
    assert.deepEqual(
      calls.filter((c) => c.model === model),
      [],
      model,
    );
  // An empty seed inserts nothing.
  assert.deepEqual(
    calls.filter((c) => c.method === "createMany"),
    [],
  );
});

// What the reset writes to the account Go's sign-in reads: the demo's loginId,
// the hash no password matches, session version 0 and now for both times, and
// nothing at all when the account is there (its password, name and session
// version stay). Members carry no role column: Go's LoginDemo makes the demo
// a member from this row.
test("the account is Go's demo account", async () => {
  const { db, calls } = fakeDb();
  const store = createDemoResetStore(
    () => db,
    () => "cnewaccount",
  );
  await store.reset("demo", emptySeed, now);
  const [insert, select] = calls
    .filter((c) => c.model === "$raw")
    .map((c) => c.args[0] as { text: string; values: unknown[] });

  assert.equal(
    flat(insert.text).trim(),
    'INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "sessionVersion", "createdAt", "updatedAt") ' +
      "VALUES ($1, $2, $3, $4, 0, CAST($5 AS TIMESTAMP(3)), CAST($6 AS TIMESTAMP(3))) " +
      'ON CONFLICT ("loginId") DO NOTHING',
  );
  assert.deepEqual(insert.values, [
    "cnewaccount",
    "demo",
    "デモ",
    "demo:no-password",
    now,
    now,
  ]);
  assert.equal(
    flat(select.text).trim(),
    'SELECT "id" FROM "PasswordAccount" WHERE "loginId" = $1 FOR UPDATE',
  );
  assert.deepEqual(select.values, ["demo"]);
});

test("the reset inserts the seed in foreign-key order", async () => {
  const { db, calls } = fakeDb();
  let n = 0;
  const store = createDemoResetStore(
    () => db,
    () => `c${++n}`,
  );
  await store.reset("demo", smallSeed(), now);
  assert.deepEqual(
    calls.filter((c) => c.method === "createMany").map((c) => c.model),
    [
      "importBatch",
      "learningEntry",
      "hint",
      "vocabularyEntry",
      "reviewItem",
      "reviewLog",
      "chatConversation",
      "prepositionPracticeRecord",
      "complementPracticeRecord",
    ],
  );
  // The inserts come after every delete.
  const lastDelete = calls.findLastIndex((c) => c.method === "deleteMany");
  const firstCreate = calls.findIndex((c) => c.method === "createMany");
  assert.ok(lastDelete < firstCreate);
});

const t = (iso: string) => new Date(iso);

function card(over: Partial<FsrsCard>): FsrsCard {
  return {
    due: t("2026-11-01T00:00:00.000Z"),
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    remainingSteps: 0,
    lastReview: null,
    ...over,
  };
}

const note0At = t("2026-11-03T01:00:00.000Z");
const note1At = t("2026-11-04T02:30:00.000Z");
const wordAt = t("2026-11-03T01:05:00.000Z");

function smallSeed(): DemoSeed {
  const noteNew = card({ due: note0At });
  const noteAfter = card({
    due: t("2026-11-03T02:10:00.000Z"),
    stability: 2.3,
    difficulty: 5.1,
    reps: 1,
    state: 1,
    remainingSteps: 1,
    lastReview: t("2026-11-03T02:00:00.000Z"),
  });
  const wordNew = card({ due: wordAt });
  const wordMid = card({
    due: t("2026-11-03T03:10:00.000Z"),
    stability: 1.2,
    difficulty: 6,
    reps: 1,
    state: 1,
    lastReview: t("2026-11-03T03:00:00.000Z"),
  });
  const wordAfter = card({
    due: t("2026-11-06T03:00:00.000Z"),
    stability: 3.4,
    difficulty: 5.5,
    scheduledDays: 2,
    reps: 2,
    state: 2,
    lastReview: t("2026-11-04T03:00:00.000Z"),
  });
  return {
    displayName: "デモ",
    notes: [
      {
        kind: "correction",
        originalText: "我昨天去学校了吗",
        correctedText: "我昨天去学校了。",
        pinyin: "wǒ zuótiān qù xuéxiào le.",
        hints: ["了", "学校"],
        createdAt: note0At,
        review: {
          card: noteAfter,
          answers: [
            { rating: 3, at: t("2026-11-03T02:00:00.000Z"), before: noteNew },
          ],
        },
      },
      {
        kind: "translation",
        originalText: "図書館に行きます。",
        correctedText: "我去图书馆。",
        pinyin: "wǒ qù túshūguǎn.",
        hints: [],
        createdAt: note1At,
        review: null,
      },
    ],
    words: [
      {
        id: "w-uuid",
        word: "学校",
        pinyin: "xuéxiào",
        meaning: "学校",
        sourceNote: 0,
        createdAt: wordAt,
        review: {
          card: wordAfter,
          answers: [
            { rating: 1, at: t("2026-11-03T03:00:00.000Z"), before: wordNew },
            { rating: 3, at: t("2026-11-04T03:00:00.000Z"), before: wordMid },
          ],
        },
      },
    ],
    conversations: [
      {
        id: "conv-uuid",
        title: "週末の予定",
        modelName: "gpt-x",
        ended: true,
        createdAt: t("2026-11-05T10:00:00.000Z"),
        updatedAt: t("2026-11-05T10:02:00.000Z"),
        messages: [
          { id: "m1", role: "user", text: "你好" },
          { id: "m2", role: "assistant", text: "你好！" },
        ],
      },
    ],
    prepositionRecords: [
      {
        id: "p-uuid",
        elapsedMs: 42_000,
        startedAt: t("2026-11-06T11:00:00.000Z"),
        createdAt: t("2026-11-06T11:00:42.000Z"),
        // Go counts these from the questions when it writes (demoScore).
        questionCount: 0,
        firstTryCount: 0,
        missCount: 0,
        questions: [
          {
            id: "",
            answer: "在",
            noun: "图书馆",
            prompt: "我__看书",
            misses: [],
          },
          {
            id: "q2",
            answer: "跟",
            noun: "朋友",
            prompt: "我__去",
            misses: ["在", "对"],
          },
        ],
      },
    ],
    complementRecords: [
      {
        id: "c-uuid",
        mode: "result",
        elapsedMs: 10_000,
        startedAt: t("2026-11-07T12:00:00.000Z"),
        createdAt: t("2026-11-07T12:00:10.000Z"),
        questionCount: 1,
        firstTryCount: 1,
        missCount: 0,
        questions: [
          { id: "k1", answer: "完", noun: "", prompt: "写__了", misses: [] },
        ],
      },
    ],
  };
}

// Go: insertDemoSeed, queueImportBatch, queueHints, queueDemoReview and
// practiceKind.insert (store/demo.go, entries.go, practice_records.go).
test("seed rows are Go's rows", () => {
  let n = 0;
  const seed = smallSeed();
  const rows = demoSeedRows("password:c1", seed, () => `r${++n}`);
  const owner = "password:c1";

  assert.equal(rows.importBatches.length, 2);
  assert.deepEqual(rows.importBatches[0], {
    id: rows.learningEntries[0].batchId,
    fileName: "demo:2026-11-03T01:00:00.000Z",
    rowCount: 1,
    importedAt: note0At,
  });
  assert.equal(rows.importBatches[1].fileName, `demo:${note1At.toISOString()}`);
  assert.deepEqual(rows.learningEntries[0], {
    id: rows.learningEntries[0].id,
    kind: "correction",
    originalText: "我昨天去学校了吗",
    correctedText: "我昨天去学校了。",
    pinyin: "wǒ zuótiān qù xuéxiào le.",
    createdAt: note0At,
    ownerId: owner,
    batchId: rows.importBatches[0].id,
  });
  assert.equal(rows.learningEntries[1].kind, "translation");
  assert.equal(rows.learningEntries[1].createdAt, note1At);
  assert.equal(rows.learningEntries[1].batchId, rows.importBatches[1].id);
  assert.deepEqual(
    rows.hints.map(({ content, position, learningEntryId }) => ({
      content,
      position,
      learningEntryId,
    })),
    [
      {
        content: "了",
        position: 0,
        learningEntryId: rows.learningEntries[0].id,
      },
      {
        content: "学校",
        position: 1,
        learningEntryId: rows.learningEntries[0].id,
      },
    ],
  );

  assert.deepEqual(rows.vocabularyEntries, [
    {
      id: "w-uuid",
      ownerId: owner,
      language: "zh",
      word: "学校",
      pinyin: "xuéxiào",
      meaning: "学校",
      sourceEntryId: rows.learningEntries[0].id,
      createdAt: wordAt,
      updatedAt: wordAt,
    },
  ]);

  const [noteItem, wordItem] = rows.reviewItems;
  assert.equal(rows.reviewItems.length, 2);
  const noteCard = seed.notes[0].review!.card;
  assert.deepEqual(noteItem, {
    id: noteItem.id,
    ownerId: owner,
    language: "zh",
    kind: "entry",
    targetId: rows.learningEntries[0].id,
    due: noteCard.due,
    stability: noteCard.stability,
    difficulty: noteCard.difficulty,
    scheduledDays: noteCard.scheduledDays,
    reps: noteCard.reps,
    lapses: noteCard.lapses,
    state: noteCard.state,
    remainingSteps: noteCard.remainingSteps,
    lastReview: noteCard.lastReview,
    createdAt: note0At,
    updatedAt: noteCard.lastReview,
  });
  assert.equal(wordItem.kind, "vocabulary");
  assert.equal(wordItem.language, "zh");
  assert.equal(wordItem.targetId, "w-uuid");
  assert.equal(wordItem.createdAt, wordAt);
  assert.equal(wordItem.updatedAt, seed.words[0].review.card.lastReview);
  assert.equal(wordItem.state, 2);
  // A card never answered keeps its createdAt as updatedAt.
  const unanswered = demoSeedRows(
    owner,
    {
      ...seed,
      words: [
        {
          ...seed.words[0],
          review: { card: card({ due: wordAt }), answers: [] },
        },
      ],
    },
    () => `u${++n}`,
  ).reviewItems[1];
  assert.equal(unanswered.lastReview, null);
  assert.equal(unanswered.updatedAt, wordAt);

  assert.equal(rows.reviewLogs.length, 3);
  const [noteLog, wordLog1, wordLog2] = rows.reviewLogs;
  assert.deepEqual(noteLog, {
    id: noteLog.id,
    ownerId: owner,
    itemId: noteItem.id,
    rating: 3,
    state: 0,
    due: note0At,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    reviewedAt: t("2026-11-03T02:00:00.000Z"),
  });
  // Each log keeps the card from before its answer.
  assert.equal(wordLog1.itemId, wordItem.id);
  assert.equal(wordLog1.rating, 1);
  assert.equal(wordLog1.state, 0);
  assert.equal(wordLog1.due, wordAt);
  assert.equal(wordLog2.rating, 3);
  assert.equal(wordLog2.state, 1);
  assert.equal(wordLog2.stability, 1.2);
  assert.equal(wordLog2.difficulty, 6);
  assert.equal(wordLog2.due.toISOString(), "2026-11-03T03:10:00.000Z");
  assert.equal(wordLog2.reviewedAt.toISOString(), "2026-11-04T03:00:00.000Z");

  // Row ids are fresh and distinct.
  const ids = [
    ...rows.importBatches,
    ...rows.learningEntries,
    ...rows.hints,
    ...rows.reviewItems,
    ...rows.reviewLogs,
  ].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);

  assert.deepEqual(rows.conversations, [
    {
      id: "conv-uuid",
      ownerId: owner,
      title: "週末の予定",
      modelName: "gpt-x",
      ended: true,
      messages: [
        { id: "m1", role: "user", text: "你好" },
        { id: "m2", role: "assistant", text: "你好！" },
      ],
      createdAt: t("2026-11-05T10:00:00.000Z"),
      updatedAt: t("2026-11-05T10:02:00.000Z"),
    },
  ]);

  assert.deepEqual(rows.prepositionRecords, [
    {
      id: "p-uuid",
      ownerId: owner,
      questionCount: 2,
      firstTryCount: 1,
      missCount: 2,
      elapsedMs: 42_000,
      // Go writes PracticeQuestion with `json:"id,omitempty"`.
      questions: [
        { answer: "在", noun: "图书馆", prompt: "我__看书", misses: [] },
        {
          id: "q2",
          answer: "跟",
          noun: "朋友",
          prompt: "我__去",
          misses: ["在", "对"],
        },
      ],
      startedAt: t("2026-11-06T11:00:00.000Z"),
      createdAt: t("2026-11-06T11:00:42.000Z"),
    },
  ]);
  assert.ok(!("id" in rows.prepositionRecords[0].questions[0]));
  assert.deepEqual(rows.complementRecords, [
    {
      id: "c-uuid",
      ownerId: owner,
      mode: "result",
      questionCount: 1,
      firstTryCount: 1,
      missCount: 0,
      elapsedMs: 10_000,
      questions: [
        { id: "k1", answer: "完", noun: "", prompt: "写__了", misses: [] },
      ],
      startedAt: t("2026-11-07T12:00:00.000Z"),
      createdAt: t("2026-11-07T12:00:10.000Z"),
    },
  ]);
});
