import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "../src/generated/prisma/client";
import type { SessionPrincipal } from "../src/domain/identity/session";
import { hashSessionToken } from "../src/infrastructure/auth/session-token";
import {
  createSessionStore,
  pruneSessionsSql,
} from "../src/infrastructure/prisma/session-store";

const now = new Date("2026-11-17T03:00:00.000Z");
const token = "T".repeat(43);

const flat = (text: string) => text.replace(/\s+/g, " ");

const tokens = {
  newToken: () => token,
  hash: hashSessionToken,
  isShape: (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value),
};

function fakeDb(row: Record<string, unknown> | null = null) {
  const calls: { op: string; args: unknown }[] = [];
  const db = {
    $executeRaw: async (sql: unknown) => {
      calls.push({ op: "executeRaw", args: sql });
      return 0;
    },
    session: {
      create: async (args: unknown) => {
        calls.push({ op: "create", args });
        return {};
      },
      findUnique: async (args: unknown) => {
        calls.push({ op: "findUnique", args });
        return row;
      },
      deleteMany: async (args: unknown) => {
        calls.push({ op: "deleteMany", args });
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

test("pruneSessionsSql deletes a bounded batch of expired rows", () => {
  const sql = pruneSessionsSql(now);
  const text = flat(sql.text);
  for (const part of [
    'DELETE FROM "Session" WHERE "id" IN (',
    '"expiresAt" <= CAST($1 AS TIMESTAMP(3))',
    "LIMIT $2 FOR UPDATE SKIP LOCKED",
  ]) {
    assert.ok(text.includes(part), text);
  }
  assert.deepEqual(sql.values, [now, 100]);
});

test("start prunes, then stores only the SHA-256 of the token", async () => {
  const { db, calls } = fakeDb();
  const store = createSessionStore(() => db, tokens);
  const returned = await store.start(
    { role: "member", ownerId: "password:c1", sessionVersion: 2 },
    now,
  );

  assert.equal(returned, token);
  assert.deepEqual(
    calls.map((call) => call.op),
    ["executeRaw", "create"],
  );
  const prune = calls[0].args as { text: string; values: unknown[] };
  assert.equal(prune.text, pruneSessionsSql(now).text);
  assert.deepEqual(prune.values, [now, 100]);
  const { data } = calls[1].args as { data: Record<string, unknown> };
  assert.deepEqual(data, {
    tokenHash: hashSessionToken(token),
    ownerId: "password:c1",
    role: "member",
    login: null,
    sessionVersion: 2,
    expiresAt: new Date("2026-12-17T03:00:00.000Z"),
  });
  assert.ok(!JSON.stringify(data).includes(token));
});

test("a guest session ends after 24 hours and an admin keeps the login", async () => {
  const cases: [SessionPrincipal, Record<string, unknown>][] = [
    [
      { role: "guest", ownerId: "guest" },
      {
        ownerId: "guest",
        role: "guest",
        login: null,
        sessionVersion: null,
        expiresAt: new Date(now.getTime() + 86_400_000),
      },
    ],
    [
      { role: "admin", ownerId: "10001", login: "alice" },
      {
        ownerId: "10001",
        role: "admin",
        login: "alice",
        sessionVersion: null,
        expiresAt: new Date(now.getTime() + 2_592_000_000),
      },
    ],
  ];
  for (const [principal, expected] of cases) {
    const { db, calls } = fakeDb();
    await createSessionStore(() => db, tokens).start(principal, now);
    const { data } = calls[1].args as { data: Record<string, unknown> };
    assert.deepEqual(data, { tokenHash: hashSessionToken(token), ...expected });
  }
});

test("find refuses a malformed token without a query", async () => {
  const { db, calls } = fakeDb({
    ownerId: "guest",
    role: "guest",
    login: null,
    sessionVersion: null,
    expiresAt: new Date(now.getTime() + 1),
  });
  assert.equal(
    await createSessionStore(() => db, tokens).find("short", now),
    null,
  );
  assert.deepEqual(calls, []);
});

test("find returns the principal of a live row only", async () => {
  const member = {
    ownerId: "password:c1",
    role: "member",
    login: null,
    sessionVersion: 3,
  };
  {
    const { db, calls } = fakeDb({
      ...member,
      expiresAt: new Date(now.getTime() + 1),
    });
    assert.deepEqual(
      await createSessionStore(() => db, tokens).find(token, now),
      {
        role: "member",
        ownerId: "password:c1",
        sessionVersion: 3,
      },
    );
    assert.equal(calls.length, 1);
    const args = calls[0].args as { where: unknown };
    assert.deepEqual(args.where, { tokenHash: hashSessionToken(token) });
  }
  {
    const { db } = fakeDb({ ...member, expiresAt: now });
    assert.equal(
      await createSessionStore(() => db, tokens).find(token, now),
      null,
    );
  }
  {
    const { db } = fakeDb(null);
    assert.equal(
      await createSessionStore(() => db, tokens).find(token, now),
      null,
    );
  }
  {
    const { db } = fakeDb({
      ...member,
      role: "owner",
      expiresAt: new Date(now.getTime() + 1),
    });
    assert.equal(
      await createSessionStore(() => db, tokens).find(token, now),
      null,
    );
  }
});

test("end deletes by the token's hash only", async () => {
  {
    const { db, calls } = fakeDb();
    await createSessionStore(() => db, tokens).end(token);
    assert.deepEqual(calls, [
      {
        op: "deleteMany",
        args: { where: { tokenHash: hashSessionToken(token) } },
      },
    ]);
  }
  {
    const { db, calls } = fakeDb();
    await createSessionStore(() => db, tokens).end("short");
    assert.deepEqual(calls, []);
  }
});
