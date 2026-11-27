import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  dropMigratedDatabases,
  MigrationFailed,
  migrateFrom,
} from "./migrate-from";

after(dropMigratedDatabases);

type Admin = { githubId: string; sidSub: string; email: string; name: string };

// The tables whose owner column moves to "userId".
const OWNED_TABLES = [
  "LearningEntry",
  "ChatConversation",
  "PrepositionPracticeRecord",
  "QuickQuestion",
  "ComplementPracticeRecord",
  "ReviewItem",
  "ReviewLog",
  "VocabularyEntry",
  "AiUsage",
  "LineLink",
  "LineLinkCode",
  "LineMessage",
];

function text(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// One row in every owned table, owned by owner. n keeps the keys apart.
function ownedRows(owner: string, n: number, role: "member" | "admin") {
  const o = text(owner);
  return `
INSERT INTO "LearningEntry" ("id", "originalText", "correctedText", "pinyin", "batchId", "ownerId")
  VALUES ('e${n}', 'orig', 'fixed', 'pin', 'b1', ${o});
INSERT INTO "ChatConversation" ("id", "ownerId", "title", "modelName", "ended", "messages", "updatedAt")
  VALUES ('c${n}', ${o}, 't', 'm', false, '[]', now());
INSERT INTO "PrepositionPracticeRecord" ("id", "ownerId", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions", "startedAt")
  VALUES ('pp${n}', ${o}, 1, 1, 0, 10, '[]', now());
INSERT INTO "QuickQuestion" ("id", "ownerId", "question", "answer", "modelName")
  VALUES ('q${n}', ${o}, 'q', 'a', 'm');
INSERT INTO "ComplementPracticeRecord" ("id", "ownerId", "mode", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions", "startedAt")
  VALUES ('cp${n}', ${o}, 'result', 1, 1, 0, 10, '[]', now());
INSERT INTO "ReviewItem" ("id", "ownerId", "language", "kind", "targetId", "due", "updatedAt")
  VALUES ('ri${n}', ${o}, 'zh', 'entry', 'e${n}', now(), now());
INSERT INTO "ReviewLog" ("id", "ownerId", "itemId", "rating", "state", "due", "stability", "difficulty", "scheduledDays", "reviewedAt")
  VALUES ('rl${n}', ${o}, 'ri${n}', 3, 0, now(), 1, 1, 1, now());
INSERT INTO "VocabularyEntry" ("id", "ownerId", "language", "word", "pinyin", "meaning", "updatedAt")
  VALUES ('v${n}', ${o}, 'zh', 'w${n}', 'p', 'm', now());
INSERT INTO "AiUsage" ("id", "ownerId", "feature", "model", "inputTokens", "outputTokens")
  VALUES ('ai${n}', ${o}, 'f', 'm', 1, 2);
INSERT INTO "LineLink" ("lineUserId", "ownerId", "role") VALUES ('U${n}', ${o}, '${role}');
INSERT INTO "LineLinkCode" ("codeHash", "ownerId", "role", "expiresAt") VALUES ('h${n}', ${o}, '${role}', now());
INSERT INTO "LineMessage" ("id", "webhookEventId", "lineUserId", "ownerId", "kind", "updatedAt")
  VALUES ('lm${n}', 'w${n}', 'U${n}', ${o}, 'correction', now());
`;
}

// The database as it stands before the migration: member p1 (password,
// login id "a-b.c") and member sid9 (Sparklingstadt ID), each owning one row of
// every owned table, p1 following sid9, and, when given, the admin row the
// deployment script puts in "_better_auth_admin" with one row of every owned
// table owned by the admin's GitHub id. orphanOwner and adminOwned add a note
// owned by that id.
function seed(options: {
  admin: Admin | null;
  orphanOwner?: string;
  adminOwned?: string;
}): string {
  const { admin } = options;
  let sql = `
INSERT INTO "ImportBatch" ("id", "fileName", "rowCount") VALUES ('b1', 'f.csv', 0);
INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "createdAt", "updatedAt")
  VALUES ('p1', 'a-b.c', 'Member P', 'scrypt:hash', '2026-10-01', '2026-10-02');
INSERT INTO "SidAccount" ("id", "email", "displayName", "updatedAt", "lastLoginAt")
  VALUES ('sid9', 'sid9@example.com', 'Member S', now(), now());
INSERT INTO "Session" ("id", "tokenHash", "ownerId", "role", "sessionVersion", "expiresAt")
  VALUES ('s1', 'th', 'password:p1', 'member', 0, now());
INSERT INTO "SignInThrottle" ("key", "count", "expiresAt") VALUES ('client:1', 1, now());
INSERT INTO "Follow" ("followerId", "followeeId") VALUES ('password:p1', 'sid:sid9');
${ownedRows("password:p1", 1, "member")}
${ownedRows("sid:sid9", 2, "member")}
`;
  if (admin) {
    sql += `
CREATE TABLE "_better_auth_admin" ("githubId" TEXT, "sidSub" TEXT, "email" TEXT, "name" TEXT);
INSERT INTO "_better_auth_admin" VALUES (${text(admin.githubId)}, ${text(admin.sidSub)}, ${text(admin.email)}, ${text(admin.name)});
${ownedRows(admin.githubId, 3, "admin")}
INSERT INTO "Follow" ("followerId", "followeeId") VALUES (${text(admin.githubId)}, 'password:p1');
`;
  }
  if (options.orphanOwner) {
    sql += `INSERT INTO "LearningEntry" ("id", "originalText", "correctedText", "pinyin", "batchId", "ownerId")
      VALUES ('orphan', 'o', 'c', 'p', 'b1', ${text(options.orphanOwner)});\n`;
  }
  if (options.adminOwned) {
    sql += `INSERT INTO "LearningEntry" ("id", "originalText", "correctedText", "pinyin", "batchId", "ownerId")
      VALUES ('admin-owned', 'o', 'c', 'p', 'b1', ${text(options.adminOwned)});\n`;
  }
  return sql;
}

const ADMIN: Admin = {
  githubId: "123",
  sidSub: "s1",
  email: "o@x",
  name: "Owner",
};

async function tableExists(
  db: Awaited<ReturnType<typeof migrateFrom>>,
  table: string,
) {
  const result = await db.query(`SELECT to_regclass($1) AS "t"`, [
    `public."${table}"`,
  ]);
  return result.rows[0].t !== null;
}

async function columns(
  db: Awaited<ReturnType<typeof migrateFrom>>,
  table: string,
) {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return result.rows.map((row) => row.column_name as string);
}

test("members, sid members and the admin keep their notes", async () => {
  const db = await migrateFrom(seed({ admin: ADMIN }));
  const owners =
    await db.query(`SELECT e."userId", u."username", u."role", a."providerId", a."accountId"
    FROM "LearningEntry" e JOIN "user" u ON u.id = e."userId" JOIN "account" a ON a."userId" = u.id ORDER BY u."role", a."providerId"`);
  assert.deepEqual(
    owners.rows.map((r) => [r.role, r.providerId, r.accountId ?? r.username]),
    [
      ["admin", "sid", "s1"],
      ["user", "credential", "p1"],
      ["user", "sid", "sid9"],
    ],
  );
  const follow = await db.query(
    `SELECT f."followerId", f."followeeId", u."name" AS "followee" FROM "Follow" f
      JOIN "user" u ON u.id = f."followeeId" WHERE f."followerId" = 'p1'`,
  );
  assert.equal(follow.rows[0].followerId, "p1");
  assert.equal(follow.rows[0].followee, "Member S");
  const member = await db.query(
    `SELECT email, "emailVerified" FROM "user" WHERE id = 'p1'`,
  );
  assert.deepEqual(member.rows[0], {
    email: "a-b.c@members.zhuelog.invalid",
    emailVerified: false,
  });
});

test("users and accounts are made from the old accounts", async () => {
  const db = await migrateFrom(seed({ admin: ADMIN }));
  const users = await db.query(
    `SELECT u.id, u.name, u.email, u."emailVerified", u.username, u."displayUsername", u.role,
            u."isAnonymous", u."createdAt"::text AS "createdAt",
            a."providerId", a."accountId", a.password
       FROM "user" u JOIN "account" a ON a."userId" = u.id ORDER BY u.name`,
  );
  assert.equal(users.rows.length, 3);
  const [member, sidMember, admin] = users.rows;
  assert.deepEqual(member, {
    id: "p1",
    name: "Member P",
    email: "a-b.c@members.zhuelog.invalid",
    emailVerified: false,
    username: "a-b.c",
    displayUsername: "a-b.c",
    role: "user",
    isAnonymous: false,
    createdAt: "2026-10-01 00:00:00",
    providerId: "credential",
    accountId: "p1",
    password: "scrypt:hash",
  });
  assert.match(sidMember.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...sidMember, id: undefined, createdAt: undefined },
    {
      id: undefined,
      name: "Member S",
      email: "sid9@example.com",
      emailVerified: true,
      username: null,
      displayUsername: null,
      role: "user",
      isAnonymous: false,
      createdAt: undefined,
      providerId: "sid",
      accountId: "sid9",
      password: null,
    },
  );
  assert.match(admin.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    [
      admin.name,
      admin.email,
      admin.emailVerified,
      admin.role,
      admin.providerId,
      admin.accountId,
    ],
    ["Owner", "o@x", true, "admin", "sid", "s1"],
  );
});

test("every owned table moves to userId with a foreign key", async () => {
  const db = await migrateFrom(seed({ admin: ADMIN }));
  const users = await db.query(`SELECT id, role, name FROM "user"`);
  const idOf = (name: string) => users.rows.find((u) => u.name === name)!.id;
  for (const table of OWNED_TABLES) {
    const cols = await columns(db, table);
    assert.ok(cols.includes("userId"), `${table} has userId`);
    assert.ok(!cols.includes("ownerId"), `${table} has no ownerId`);
    assert.ok(!cols.includes("role"), `${table} has no role`);
    const owners = await db.query(
      `SELECT "userId" FROM "${table}" ORDER BY "userId"`,
    );
    assert.deepEqual(
      owners.rows.map((r) => r.userId).sort(),
      [idOf("Member P"), idOf("Member S"), idOf("Owner")].sort(),
      table,
    );
  }
  const fks = await db.query(
    `SELECT conrelid::regclass::text AS "table", conname, confdeltype
       FROM pg_constraint WHERE contype = 'f' AND confrelid = '"user"'::regclass ORDER BY 1, 2`,
  );
  const named = fks.rows.map((r) => `${r.table}.${r.conname}.${r.confdeltype}`);
  for (const table of OWNED_TABLES) {
    assert.ok(
      named.includes(`"${table}".${table}_userId_fkey.c`),
      `${table} has a cascading foreign key: ${named.join(", ")}`,
    );
  }
  assert.ok(named.includes(`"Follow".Follow_followerId_fkey.c`));
  assert.ok(named.includes(`"Follow".Follow_followeeId_fkey.c`));

  const lineLinks = await db.query(
    `SELECT l."lineUserId", u.role FROM "LineLink" l JOIN "user" u ON u.id = l."userId" ORDER BY 1`,
  );
  assert.deepEqual(
    lineLinks.rows.map((r) => [r.lineUserId, r.role]),
    [
      ["U1", "user"],
      ["U2", "user"],
      ["U3", "admin"],
    ],
  );
  const adminFollow = await db.query(
    `SELECT "followeeId" FROM "Follow" WHERE "followerId" = $1`,
    [idOf("Owner")],
  );
  assert.deepEqual(adminFollow.rows, [{ followeeId: "p1" }]);

  const indexes = await db.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%userId%' ORDER BY 1`,
  );
  const indexNames = indexes.rows.map((r) => r.indexname as string);
  for (const name of [
    "AiUsage_userId_createdAt_idx",
    "ChatConversation_id_userId_key",
    "ChatConversation_userId_createdAt_idx",
    "ChatConversation_userId_updatedAt_idx",
    "ComplementPracticeRecord_id_userId_key",
    "ComplementPracticeRecord_userId_createdAt_idx",
    "LearningEntry_userId_createdAt_idx",
    "LearningEntry_userId_deletedAt_idx",
    "LearningEntry_userId_sharedAt_idx",
    "LineLinkCode_userId_key",
    "LineLink_userId_key",
    "PrepositionPracticeRecord_id_userId_key",
    "PrepositionPracticeRecord_userId_createdAt_idx",
    "QuickQuestion_userId_createdAt_idx",
    "ReviewItem_userId_due_idx",
    "ReviewItem_userId_language_kind_targetId_key",
    "ReviewLog_userId_reviewedAt_idx",
    "VocabularyEntry_userId_createdAt_idx",
    "VocabularyEntry_userId_language_word_key",
  ]) {
    assert.ok(indexNames.includes(name), `index ${name}`);
  }
  const follow = await db.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'Follow' ORDER BY 1`,
  );
  assert.deepEqual(
    follow.rows.map((r) => r.indexname),
    ["Follow_followeeId_idx", "Follow_pkey"],
  );
});

test("the old tables and the work tables are dropped", async () => {
  const db = await migrateFrom(seed({ admin: ADMIN }));
  for (const table of [
    "PasswordAccount",
    "SidAccount",
    "Session",
    "SignInThrottle",
    "FfpfAccount",
    "_owner_map",
    "_better_auth_admin",
  ]) {
    assert.equal(await tableExists(db, table), false, table);
  }
  assert.equal(await tableExists(db, "session"), true);
});

test("without an admin row the migration still moves the members", async () => {
  const db = await migrateFrom(seed({ admin: null }));
  const users = await db.query(`SELECT role FROM "user" ORDER BY role`);
  assert.deepEqual(
    users.rows.map((r) => r.role),
    ["user", "user"],
  );
});

test("an owner with no user stops the migration and changes nothing", async () => {
  const error = await migrateFrom(
    seed({ admin: null, orphanOwner: "999" }),
  ).then(
    () => assert.fail("the migration should fail"),
    (e: unknown) => e,
  );
  assert.ok(error instanceof MigrationFailed);
  assert.match(error.message, /LearningEntry/);
  assert.match(error.message, /\b1\b/);
  const db = error.db;
  assert.equal(await tableExists(db, "PasswordAccount"), true);
  assert.equal(await tableExists(db, "_owner_map"), false);
  assert.ok((await columns(db, "LearningEntry")).includes("ownerId"));
  assert.ok(!(await columns(db, "LearningEntry")).includes("userId"));
  const users = await db.query(`SELECT count(*)::int AS n FROM "user"`);
  assert.equal(users.rows[0].n, 0);
});

test("the admin's GitHub-owned rows need the admin row", async () => {
  await assert.rejects(
    migrateFrom(seed({ admin: null, adminOwned: "123" })),
    /123|LearningEntry/,
  );
});

test("a follow of a removed member stops the migration", async () => {
  await assert.rejects(
    migrateFrom(
      seed({ admin: null }) +
        `INSERT INTO "Follow" ("followerId", "followeeId") VALUES ('password:p1', 'password:gone');`,
    ),
    /Follow/,
  );
});
