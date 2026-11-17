import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GUEST_SESSION_TTL_MS,
  SESSION_TTL_MS,
  sessionTtlMs,
  toSessionPrincipal,
} from "../src/domain/identity/session";

test("the session lengths are Go's refresh lengths", () => {
  assert.equal(SESSION_TTL_MS, 30 * 24 * 3600 * 1000);
  assert.equal(GUEST_SESSION_TTL_MS, 24 * 3600 * 1000);
  assert.equal(
    sessionTtlMs({ role: "admin", ownerId: "10001", login: "alice" }),
    SESSION_TTL_MS,
  );
  assert.equal(
    sessionTtlMs({ role: "member", ownerId: "password:c1", sessionVersion: 0 }),
    SESSION_TTL_MS,
  );
  assert.equal(
    sessionTtlMs({ role: "guest", ownerId: "guest" }),
    GUEST_SESSION_TTL_MS,
  );
});

test("toSessionPrincipal keeps only the shapes Go would accept", () => {
  assert.deepEqual(
    toSessionPrincipal({
      ownerId: "10001",
      role: "admin",
      login: "alice",
      sessionVersion: null,
    }),
    { role: "admin", ownerId: "10001", login: "alice" },
  );
  assert.deepEqual(
    toSessionPrincipal({
      ownerId: "password:c1",
      role: "member",
      login: null,
      sessionVersion: 0,
    }),
    { role: "member", ownerId: "password:c1", sessionVersion: 0 },
  );
  assert.deepEqual(
    toSessionPrincipal({
      ownerId: "guest",
      role: "guest",
      login: null,
      sessionVersion: null,
    }),
    { role: "guest", ownerId: "guest" },
  );

  const refused = [
    { ownerId: "10001", role: "admin", login: "", sessionVersion: null },
    { ownerId: "10001", role: "admin", login: null, sessionVersion: null },
    {
      ownerId: "password:c1",
      role: "member",
      login: null,
      sessionVersion: null,
    },
    { ownerId: "password:c1", role: "member", login: null, sessionVersion: -1 },
    {
      ownerId: "password:c1",
      role: "member",
      login: null,
      sessionVersion: 1.5,
    },
    { ownerId: "", role: "member", login: null, sessionVersion: 0 },
    { ownerId: "x", role: "guest", login: null, sessionVersion: null },
    { ownerId: "10001", role: "owner", login: "alice", sessionVersion: null },
  ];
  for (const row of refused) {
    assert.equal(toSessionPrincipal(row), null, JSON.stringify(row));
  }
});
