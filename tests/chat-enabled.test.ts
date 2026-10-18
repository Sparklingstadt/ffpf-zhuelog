import assert from "node:assert/strict";
import { test } from "node:test";
import { isChatEnabled } from "../src/infrastructure/config/environment";
import { chatDisabledResponse } from "../src/presentation/http/chat-disabled-response";

function withChatEnabled(value: string | undefined) {
  const saved = process.env.CHAT_ENABLED;
  try {
    if (value === undefined) delete process.env.CHAT_ENABLED;
    else process.env.CHAT_ENABLED = value;
    return isChatEnabled();
  } finally {
    if (saved === undefined) delete process.env.CHAT_ENABLED;
    else process.env.CHAT_ENABLED = saved;
  }
}

test("chat stays disabled unless CHAT_ENABLED is exactly true", () => {
  for (const value of [undefined, "", "false", "1", "TRUE", " true"]) {
    assert.equal(withChatEnabled(value), false, `for ${String(value)}`);
  }
  assert.equal(withChatEnabled("true"), true);
});

test("disabled chat APIs answer 404 without caching", async () => {
  const response = chatDisabledResponse();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "会話機能は停止しています。",
  });
});
