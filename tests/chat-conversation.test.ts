import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationSchema } from "@ffpf-zhuelog/core/domain/chat/conversation";
const valid = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "你好",
  modelName: "gpt-6.1-sol · 推論: 中",
  ended: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  messages: [{ id: "u1", role: "user", text: "你好" }],
};
test("conversation validates limits and text-only speaker roles", () => {
  assert.ok(conversationSchema.safeParse(valid).success);
  for (const messages of [
    [],
    [{ id: "u1", role: "system", text: "bad" }],
    [{ id: "u1", role: "user", text: " " }],
    Array.from({ length: 41 }, (_, i) => ({
      id: String(i),
      role: "user",
      text: "a",
    })),
    [{ id: "u1", role: "user", text: "a".repeat(40001) }],
  ]) {
    assert.ok(!conversationSchema.safeParse({ ...valid, messages }).success);
  }
});
