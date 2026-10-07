import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrentMemberSession } from "../src/infrastructure/auth/member-session-policy";

const ACCOUNT_ID = "ckabcdefghijklmnopqrstuvw";

function neverCalled(): Promise<{ sessionVersion: number } | null> {
  throw new Error("findById must not be called");
}

function accounts(records: Record<string, { sessionVersion: number }>) {
  const calls: string[] = [];
  return {
    calls,
    findById: async (id: string) => {
      calls.push(id);
      return records[id] ?? null;
    },
  };
}

test("admin and guest sessions are accepted without a database lookup", async () => {
  // Existing GitHub admin JWTs carry neither accountId nor sessionVersion.
  assert.equal(
    await isCurrentMemberSession({ role: "admin" }, neverCalled),
    true,
  );
  assert.equal(
    await isCurrentMemberSession({ role: "guest" }, neverCalled),
    true,
  );
  assert.equal(
    await isCurrentMemberSession(
      { role: "admin", accountId: ACCOUNT_ID, sessionVersion: 0 },
      neverCalled,
    ),
    true,
  );
});

test("a member session is current only while its session version matches", async () => {
  const repo = accounts({ [ACCOUNT_ID]: { sessionVersion: 3 } });
  assert.equal(
    await isCurrentMemberSession(
      { role: "member", accountId: ACCOUNT_ID, sessionVersion: 3 },
      repo.findById,
    ),
    true,
  );
  assert.equal(
    await isCurrentMemberSession(
      { role: "member", accountId: ACCOUNT_ID, sessionVersion: 2 },
      repo.findById,
    ),
    false,
  );
  assert.deepEqual(repo.calls, [ACCOUNT_ID, ACCOUNT_ID]);
});

test("a member session for a missing account is not current", async () => {
  const repo = accounts({});
  assert.equal(
    await isCurrentMemberSession(
      { role: "member", accountId: ACCOUNT_ID, sessionVersion: 0 },
      repo.findById,
    ),
    false,
  );
});

test("a member session with malformed claims is rejected without a lookup", async () => {
  for (const claims of [
    { role: "member" as const },
    { role: "member" as const, sessionVersion: 0 },
    { role: "member" as const, accountId: 42, sessionVersion: 0 },
    { role: "member" as const, accountId: "", sessionVersion: 0 },
    { role: "member" as const, accountId: ACCOUNT_ID },
    { role: "member" as const, accountId: ACCOUNT_ID, sessionVersion: "0" },
    {
      role: "member" as const,
      accountId: ACCOUNT_ID,
      sessionVersion: Number.NaN,
    },
  ]) {
    assert.equal(
      await isCurrentMemberSession(claims, neverCalled),
      false,
      JSON.stringify(claims),
    );
  }
});
