import assert from "node:assert/strict";
import { test } from "node:test";
import { handleConversationSave } from "../src/presentation/controllers/conversation-controller";
import { ConversationOwnershipError } from "@ffpf-zhuelog/core/domain/chat/conversation";
const input = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "你好",
  modelName: "gpt-6.1-sol",
  ended: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  messages: [{ id: "u1", role: "user" as const, text: "你好" }],
};
const admin = { githubLogin: "admin", githubId: "100", role: "admin" as const };
const request = (body: unknown = input, origin = "https://test.example") =>
  new Request("https://test.example/api/chat/conversations", {
    method: "PUT",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const repository = {
  save: async (owner: string) => {
    assert.equal(owner, "100");
    return input;
  },
  list: async () => [],
  get: async () => null,
};
test("conversation save checks authentication, role, stable identity, origin and size", async () => {
  for (const [user, code] of [
    [null, 401],
    [{ ...admin, role: "guest" }, 403],
    [{ ...admin, githubId: undefined }, 401],
  ] as const)
    assert.equal(
      (await handleConversationSave(request(), user, repository)).status,
      code,
    );
  assert.equal(
    (
      await handleConversationSave(
        request(input, "https://evil.example"),
        admin,
        repository,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleConversationSave(
        request({ ...input, messages: [] }),
        admin,
        repository,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleConversationSave(
        request({ text: "a".repeat(256 * 1024) }),
        admin,
        repository,
      )
    ).status,
    413,
  );
  const result = await handleConversationSave(
    request({ ...input, ownerId: "attacker" }),
    admin,
    repository,
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
});
test("password members save conversations under their account identity; guests stay denied", async () => {
  const member = {
    githubLogin: "taro",
    githubId: "password:ckxxxxxxxxxxxxxxxxxxxxxxx",
    role: "member" as const,
  };
  let owner = "";
  const result = await handleConversationSave(request(), member, {
    ...repository,
    save: async (savedOwner: string) => {
      owner = savedOwner;
      return input;
    },
  });
  assert.equal(result.status, 200);
  assert.equal(owner, "password:ckxxxxxxxxxxxxxxxxxxxxxxx");
  assert.equal(
    (
      await handleConversationSave(
        request(),
        { ...member, role: "guest" },
        repository,
      )
    ).status,
    403,
  );
});
test("conversation ownership collision is rejected without exposing content", async () => {
  const result = await handleConversationSave(request(), admin, {
    ...repository,
    save: async () => {
      throw new ConversationOwnershipError();
    },
  });
  assert.equal(result.status, 403);
});
