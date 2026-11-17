import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  newSessionCookies,
  sessionStore,
} from "../src/composition/sign-in-container";
import { signedInCookieWrites } from "../src/infrastructure/auth/session-cookies";

const session = { token: "new-token", maxAgeSeconds: 2_592_000 };
const realEnd = sessionStore.end;
const realError = console.error;
afterEach(() => {
  sessionStore.end = realEnd;
  console.error = realError;
});

test("the new session comes with the browser's previous row deleted", async () => {
  const ended: string[] = [];
  sessionStore.end = async (token) => void ended.push(token);
  assert.deepEqual(
    await newSessionCookies("old-token", session, true),
    signedInCookieWrites(session, true),
  );
  assert.deepEqual(ended, ["old-token"]);
});

test("without a previous session nothing is ended", async () => {
  const ended: string[] = [];
  sessionStore.end = async (token) => void ended.push(token);
  assert.deepEqual(
    await newSessionCookies(undefined, session, false),
    signedInCookieWrites(session, false),
  );
  assert.deepEqual(ended, []);
});

test("a failure to end it is logged by name and the sign-in goes on", async () => {
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  sessionStore.end = async () => {
    throw new TypeError("db down old-token");
  };
  assert.deepEqual(
    await newSessionCookies("old-token", session, true),
    signedInCookieWrites(session, true),
  );
  assert.deepEqual(logged, [["SESSION_END_FAILED", "TypeError"]]);
});
