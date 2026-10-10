import assert from "node:assert/strict";
import { test } from "node:test";
import { FollowMember } from "@ffpf-zhuelog/core/application/social/use-cases/follow-member";
import { ListFollowDirectory } from "@ffpf-zhuelog/core/application/social/use-cases/list-follow-directory";
import { ListFollowTimeline } from "@ffpf-zhuelog/core/application/social/use-cases/list-follow-timeline";
import { UnfollowMember } from "@ffpf-zhuelog/core/application/social/use-cases/unfollow-member";
import type { PasswordAccount } from "@ffpf-zhuelog/core/domain/identity/entities/password-account";
import type { PasswordAccountRepository } from "@ffpf-zhuelog/core/domain/identity/repositories/password-account-repository";
import type {
  LearningEntryRepository,
  SharedLearningEntry,
} from "@ffpf-zhuelog/core/domain/learning/repositories/learning-entry-repository";
import type { FollowRepository } from "@ffpf-zhuelog/core/domain/social/repositories/follow-repository";

const ADMIN = "219588180";

class FakeFollows implements FollowRepository {
  readonly pairs = new Set<string>();

  async follow(followerId: string, followeeId: string) {
    this.pairs.add(`${followerId}>${followeeId}`);
  }
  async unfollow(followerId: string, followeeId: string) {
    return this.pairs.delete(`${followerId}>${followeeId}`);
  }
  async listFollowing(followerId: string) {
    return [...this.pairs]
      .map((pair) => pair.split(">"))
      .filter(([from]) => from === followerId)
      .map(([, to]) => to);
  }
  async listFollowers(followeeId: string) {
    return [...this.pairs]
      .map((pair) => pair.split(">"))
      .filter(([, to]) => to === followeeId)
      .map(([from]) => from);
  }
}

function account(id: string, displayName: string, tick: number) {
  return {
    id,
    loginId: `login-${id}`,
    displayName,
    passwordHash: "hash",
    sessionVersion: 1,
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: new Date(Date.UTC(2026, 0, 1) + tick * 1000),
  } satisfies PasswordAccount;
}

class FakeAccounts implements Pick<
  PasswordAccountRepository,
  "findById" | "list"
> {
  // Oldest first: 太郎, 花子, 次郎.
  readonly accounts = [
    account("a1", "太郎", 1),
    account("a2", "花子", 2),
    account("a3", "次郎", 3),
  ];
  findByIdCalls: string[] = [];

  async findById(id: string) {
    this.findByIdCalls.push(id);
    return this.accounts.find((a) => a.id === id) ?? null;
  }
  async list() {
    return [...this.accounts];
  }
}

function sharedRow(id: string, ownerId: string): SharedLearningEntry {
  return {
    id,
    ownerId,
    kind: "correction",
    originalText: "原文",
    correctedText: "訂正",
    pinyin: "pinyin",
    createdAt: new Date(Date.UTC(2026, 0, 2)),
    sharedAt: new Date(Date.UTC(2026, 0, 3)),
    hints: [],
  };
}

class FakeEntries implements Pick<
  LearningEntryRepository,
  "listSharedByOwners"
> {
  readonly calls: Array<[string[], number]> = [];
  constructor(private readonly rows: SharedLearningEntry[] = []) {}

  async listSharedByOwners(ownerIds: string[], limit: number) {
    this.calls.push([ownerIds, limit]);
    return this.rows.filter((row) => ownerIds.includes(row.ownerId));
  }
}

function setup(rows: SharedLearningEntry[] = []) {
  const follows = new FakeFollows();
  const accounts = new FakeAccounts();
  const entries = new FakeEntries(rows);
  return {
    follows,
    accounts,
    entries,
    follow: new FollowMember(
      follows,
      accounts as unknown as PasswordAccountRepository,
    ),
    unfollow: new UnfollowMember(follows),
    directory: new ListFollowDirectory(
      follows,
      accounts as unknown as PasswordAccountRepository,
    ),
    timeline: new ListFollowTimeline(
      follows,
      accounts as unknown as PasswordAccountRepository,
      entries as unknown as LearningEntryRepository,
    ),
  };
}

test("following yourself is refused and stores nothing", async () => {
  const { follow, follows } = setup();
  assert.equal(await follow.execute("password:a1", "password:a1"), "self");
  assert.equal(follows.pairs.size, 0);
});

test("following an unknown or non-member id is not found", async () => {
  const { follow, follows, accounts } = setup();
  assert.equal(await follow.execute("password:a1", "password:zz"), "not-found");
  assert.deepEqual(accounts.findByIdCalls, ["zz"]);
  assert.equal(await follow.execute("password:a1", ADMIN), "not-found");
  assert.deepEqual(accounts.findByIdCalls, ["zz"]);
  assert.equal(follows.pairs.size, 0);
});

test("following twice keeps one pair", async () => {
  const { follow, follows } = setup();
  assert.equal(await follow.execute("password:a1", "password:a2"), "followed");
  assert.equal(await follow.execute("password:a1", "password:a2"), "followed");
  assert.deepEqual(await follows.listFollowing("password:a1"), ["password:a2"]);
});

test("unfollow reports whether a pair was removed", async () => {
  const { follow, unfollow } = setup();
  await follow.execute("password:a1", "password:a2");
  assert.equal(await unfollow.execute("password:a1", "password:a2"), true);
  assert.equal(await unfollow.execute("password:a1", "password:a2"), false);
});

test("directory lists other members by name with both flags and counts", async () => {
  const { follows, directory, accounts } = setup();
  await follows.follow("password:a1", "password:a2");
  await follows.follow("password:a3", "password:a1");
  await follows.follow(ADMIN, "password:a1");

  const result = await directory.execute("password:a1");

  const expectedOrder = accounts.accounts
    .filter((a) => a.id !== "a1")
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"))
    .map((a) => `password:${a.id}`);
  assert.deepEqual(
    result.members.map((m) => m.ownerId),
    expectedOrder,
  );
  const a2 = result.members.find((m) => m.ownerId === "password:a2");
  const a3 = result.members.find((m) => m.ownerId === "password:a3");
  assert.deepEqual(a2, {
    ownerId: "password:a2",
    displayName: "花子",
    loginId: "login-a2",
    following: true,
    followsMe: false,
  });
  assert.equal(a3?.following, false);
  assert.equal(a3?.followsMe, true);
  assert.equal(result.followingCount, 1);
  assert.equal(result.followerCount, 2);
});

test("timeline shows only followed owners' shared notes with their names", async () => {
  const a2Row = sharedRow("n2", "password:a2");
  const { follows, timeline, entries } = setup([
    a2Row,
    sharedRow("n3", "password:a3"),
  ]);
  await follows.follow("password:a1", "password:a2");

  const items = await timeline.execute("password:a1");

  assert.deepEqual(entries.calls, [[["password:a2"], 100]]);
  assert.deepEqual(items, [{ entry: a2Row, ownerName: "花子" }]);
});

test("timeline drops notes whose owner has no account", async () => {
  const { follows, timeline } = setup([sharedRow("n9", "password:gone")]);
  await follows.follow("password:a1", "password:gone");
  assert.deepEqual(await timeline.execute("password:a1"), []);
});

test("timeline with no follows does not read notes", async () => {
  const { timeline, entries } = setup([sharedRow("n2", "password:a2")]);
  assert.deepEqual(await timeline.execute("password:a1"), []);
  assert.equal(entries.calls.length, 0);
});
