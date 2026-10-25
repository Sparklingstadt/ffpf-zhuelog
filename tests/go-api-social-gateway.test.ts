import assert from "node:assert/strict";
import { test } from "node:test";

import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import { GoApiError } from "../src/infrastructure/go-api/client";
import { createSocialGateway } from "../src/infrastructure/go-api/social-gateway";

function fakeCall(response: unknown) {
  const calls: { path: string; method: string }[] = [];
  const call = (async (path: string, init: { method: string }) => {
    calls.push({ path, method: init.method });
    if (response instanceof Error) throw response;
    return response;
  }) as GoApiCall;
  return { call, calls };
}

const entryJson = {
  id: "e1",
  kind: "translation",
  originalText: "今日は忙しいです。",
  correctedText: "我今天很忙。",
  pinyin: "Wǒ jīntiān hěn máng.",
  hints: [],
  createdAt: "2026-10-22T03:04:05.000Z",
  sharedAt: "2026-10-22T04:00:00.000Z",
};

test("listMembers keeps Go's members, order and counts", async () => {
  const { call, calls } = fakeCall({
    members: [
      {
        ownerId: "password:b",
        displayName: "Bさん",
        following: true,
        followsMe: false,
      },
      {
        ownerId: "password:a",
        displayName: "Aさん",
        following: false,
        followsMe: true,
      },
    ],
    followingCount: 1,
    followerCount: 3,
  });
  const directory = await createSocialGateway(call).listMembers();
  assert.deepEqual(calls, [{ path: "/v1/members", method: "GET" }]);
  assert.deepEqual(directory, {
    members: [
      {
        ownerId: "password:b",
        displayName: "Bさん",
        following: true,
        followsMe: false,
      },
      {
        ownerId: "password:a",
        displayName: "Aさん",
        following: false,
        followsMe: true,
      },
    ],
    followingCount: 1,
    followerCount: 3,
  });
});

test("listTimeline reads one page of 100 and keeps the owner on each note", async () => {
  const { call, calls } = fakeCall({
    items: [
      { entry: entryJson, ownerId: "password:b", ownerName: "Bさん" },
      {
        entry: { ...entryJson, id: "e0" },
        ownerId: "password:a",
        ownerName: "Aさん",
      },
    ],
    nextCursor: "c",
  });
  const items = await createSocialGateway(call).listTimeline();
  assert.deepEqual(calls, [{ path: "/v1/timeline?limit=100", method: "GET" }]);
  assert.deepEqual(
    items.map(({ entry, ownerName }) => [entry.id, entry.ownerId, ownerName]),
    [
      ["e1", "password:b", "Bさん"],
      ["e0", "password:a", "Aさん"],
    ],
  );
  assert.deepEqual(
    items[0].entry.createdAt,
    new Date("2026-10-22T03:04:05.000Z"),
  );
  assert.deepEqual(
    items[0].entry.sharedAt,
    new Date("2026-10-22T04:00:00.000Z"),
  );
});

test("follow and unfollow PUT and DELETE the followee", async () => {
  const { call, calls } = fakeCall(undefined);
  const gateway = createSocialGateway(call);
  assert.equal(await gateway.follow("password:ckb1"), "followed");
  await gateway.unfollow("password:ckb1");
  assert.deepEqual(calls, [
    { path: "/v1/follows/password%3Ackb1", method: "PUT" },
    { path: "/v1/follows/password%3Ackb1", method: "DELETE" },
  ]);
});

test("follow maps Go's 404 to not-found and 400 self_follow to self", async () => {
  for (const [error, expected] of [
    [new GoApiError(404, "not_found"), "not-found"],
    [new GoApiError(400, "self_follow", "自分はフォローできません。"), "self"],
  ] as const) {
    const { call } = fakeCall(error);
    assert.equal(
      await createSocialGateway(call).follow("password:x"),
      expected,
    );
  }
});

test("follow and unfollow pass every other error on", async () => {
  for (const error of [
    new GoApiError(400, "invalid_request"),
    new GoApiError(403, "forbidden"),
    new GoApiError(500, "internal"),
    new GoApiError(0, "unavailable"),
    new Error("NEXT_REDIRECT"),
  ]) {
    const { call } = fakeCall(error);
    const gateway = createSocialGateway(call);
    await assert.rejects(gateway.follow("password:x"), (e) => e === error);
    await assert.rejects(gateway.unfollow("password:x"), (e) => e === error);
  }
});
