import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSocialNetwork,
  SocialForbiddenError,
} from "../src/application/social/social-network";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import type {
  FollowDirectory,
  FollowTimelineItem,
} from "../src/domain/social/follow";

const member: AuthenticatedUser = {
  userId: "abc",
  role: "member",
  displayName: "taro",
  username: "taro",
};
const impersonated: AuthenticatedUser = {
  userId: "abc",
  role: "member",
  displayName: "太郎",
  username: "taro",
  impersonatedBy: "10001",
};
const admin: AuthenticatedUser = {
  userId: "10001",
  role: "admin",
  displayName: "octocat",
};
const demo: AuthenticatedUser = {
  userId: "demo1",
  role: "member",
  displayName: "demo",
  demo: true,
};
const guest: AuthenticatedUser = {
  userId: "g1",
  role: "guest",
  displayName: "g",
};

const now = new Date("2026-11-17T03:00:00.000Z");

const directory: FollowDirectory = {
  members: [
    {
      ownerId: "def",
      displayName: "花子",
      following: true,
      followsMe: false,
    },
  ],
  followingCount: 1,
  followerCount: 0,
};
const timeline: FollowTimelineItem[] = [
  {
    entry: {
      id: "note1",
      ownerId: "def",
      kind: "correction",
      originalText: "我吃了饭。",
      correctedText: "我吃饭了。",
      pinyin: "wǒ chī fàn le.",
      createdAt: new Date("2026-11-16T03:00:00.000Z"),
      sharedAt: new Date("2026-11-16T04:00:00.000Z"),
      hints: [],
    },
    ownerName: "花子",
  },
];

function fakeStore(followed = true) {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    store: {
      async members(viewerId: string) {
        calls.push({ method: "members", args: [viewerId] });
        return directory;
      },
      async timeline(viewerId: string, limit: number) {
        calls.push({ method: "timeline", args: [viewerId, limit] });
        return timeline;
      },
      async follow(followerId: string, followeeId: string, at: Date) {
        calls.push({ method: "follow", args: [followerId, followeeId, at] });
        return followed;
      },
      async unfollow(followerId: string, followeeId: string) {
        calls.push({ method: "unfollow", args: [followerId, followeeId] });
      },
    },
  };
}

function network(user: AuthenticatedUser | null, followed = true) {
  const fake = fakeStore(followed);
  return {
    calls: fake.calls,
    social: createSocialNetwork({
      currentUser: async () => user,
      store: fake.store,
      now: () => now,
    }),
  };
}

test("the follows are the signed-in user's", async () => {
  const { calls, social } = network(member);
  assert.equal(await social.listMembers(), directory);
  assert.equal(await social.listTimeline(), timeline);
  assert.deepEqual(calls, [
    { method: "members", args: ["abc"] },
    { method: "timeline", args: ["abc", 100] },
  ]);

  const acting = network(impersonated);
  await acting.social.listMembers();
  await acting.social.listTimeline();
  assert.deepEqual(acting.calls, [
    { method: "members", args: ["abc"] },
    { method: "timeline", args: ["abc", 100] },
  ]);

  const own = network(admin);
  await own.social.listMembers();
  await own.social.listTimeline();
  assert.deepEqual(own.calls, [
    { method: "members", args: ["10001"] },
    { method: "timeline", args: ["10001", 100] },
  ]);
});

test("the demo, guests and the signed out have no follows", async () => {
  for (const user of [demo, guest, null]) {
    const { calls, social } = network(user);
    await assert.rejects(social.listMembers(), SocialForbiddenError);
    await assert.rejects(social.listTimeline(), SocialForbiddenError);
    await assert.rejects(social.follow("def"), SocialForbiddenError);
    await assert.rejects(social.unfollow("def"), SocialForbiddenError);
    assert.deepEqual(calls, []);
  }

  // Who is asking is decided before the id is looked at.
  const { calls, social } = network(demo);
  await assert.rejects(social.follow("github:1"), SocialForbiddenError);
  await assert.rejects(social.unfollow("github:1"), SocialForbiddenError);
  assert.deepEqual(calls, []);
});

test("follow checks the id, then self, then the member", async () => {
  const checked = network(member);
  assert.equal(await checked.social.follow("github:1"), "not-found");
  assert.equal(await checked.social.follow("abc"), "self");
  assert.deepEqual(checked.calls, []);

  const missing = network(member, false);
  assert.equal(await missing.social.follow("def"), "not-found");
  assert.deepEqual(missing.calls, [
    { method: "follow", args: ["abc", "def", now] },
  ]);

  const found = network(member, true);
  assert.equal(await found.social.follow("def"), "followed");
  assert.deepEqual(found.calls, [
    { method: "follow", args: ["abc", "def", now] },
  ]);

  const acting = network(impersonated);
  assert.equal(await acting.social.follow("def"), "followed");
  assert.deepEqual(acting.calls, [
    { method: "follow", args: ["abc", "def", now] },
  ]);

  const own = network(admin);
  assert.equal(await own.social.follow("abc"), "followed");
  assert.deepEqual(own.calls, [
    { method: "follow", args: ["10001", "abc", now] },
  ]);
});

test("unfollow removes only the signed-in user's follow", async () => {
  const { calls, social } = network(member);
  await social.unfollow("def");
  await social.unfollow("github:1");
  await social.unfollow("abc");
  assert.deepEqual(calls, [
    { method: "unfollow", args: ["abc", "def"] },
    { method: "unfollow", args: ["abc", "abc"] },
  ]);
});
