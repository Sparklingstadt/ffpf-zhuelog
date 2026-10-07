import assert from "node:assert/strict";
import { test } from "node:test";
import { getLineConfig } from "../src/infrastructure/line/config";

const keys = [
  "LINE_INTEGRATION_ENABLED",
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_BOT_USER_ID",
  "LINE_ALLOWED_USER_ID",
  "LINE_NOTE_OWNER_ID",
];

function withEnv(noteOwnerId: string | undefined) {
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      LINE_INTEGRATION_ENABLED: "true",
      LINE_CHANNEL_SECRET: "secret",
      LINE_CHANNEL_ACCESS_TOKEN: "token",
      LINE_BOT_USER_ID: `U${"2".repeat(32)}`,
      LINE_ALLOWED_USER_ID: `U${"1".repeat(32)}`,
    });
    if (noteOwnerId === undefined) delete process.env.LINE_NOTE_OWNER_ID;
    else process.env.LINE_NOTE_OWNER_ID = noteOwnerId;
    return getLineConfig();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("a missing or malformed LINE_NOTE_OWNER_ID leaves LINE enabled with no owner", () => {
  for (const value of [undefined, "", "x", "12ab", "password:short", "../1"]) {
    const config = withEnv(value);
    assert.ok(config, `LINE must stay enabled for ${String(value)}`);
    assert.equal(config.noteOwnerId, null);
  }
});

test("a valid LINE_NOTE_OWNER_ID is used as the note owner", () => {
  const password = `password:${"a1".repeat(10)}`;
  for (const value of ["219588180", password, ` 219588180 `]) {
    assert.equal(withEnv(value)?.noteOwnerId, value.trim());
  }
});
