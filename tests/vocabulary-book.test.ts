import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createVocabularyBook,
  VocabularyForbiddenError,
  type VocabularyBookDeps,
} from "../src/application/vocabulary/vocabulary-book";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import type {
  OpenAiUsage,
  VocabularyDraft,
  VocabularyEntry,
  VocabularyInput,
} from "../src/domain/vocabulary/vocabulary-entry";

const member: AuthenticatedUser = {
  githubLogin: "taro",
  githubId: "password:abc",
  role: "member",
  accountId: "abc",
};
const actingAdmin: AuthenticatedUser = {
  githubLogin: "octocat",
  githubId: "password:abc",
  role: "admin",
  actingAs: { ownerId: "password:abc", loginId: "taro", displayName: "太郎" },
  actorId: "10001",
};
const demo: AuthenticatedUser = { ...member, demo: true };

const entry: VocabularyEntry = {
  id: "0b5c1f6e-2b8a-4c5e-9f1a-1d2e3f4a5b6c",
  language: "zh",
  word: "学习",
  pinyin: "xuéxí",
  meaning: "学ぶ",
  sourceEntryId: null,
  createdAt: new Date("2026-11-16T00:00:00Z"),
  updatedAt: new Date("2026-11-16T00:00:00Z"),
  nextReview: null,
};
const input: VocabularyInput = {
  id: entry.id,
  word: entry.word,
  pinyin: entry.pinyin,
  meaning: entry.meaning,
};
const drafted: VocabularyDraft = { pinyin: "xuéxí", meaning: "学ぶ" };
const usage: OpenAiUsage = {
  model: "gpt-5-mini",
  inputTokens: 12,
  outputTokens: 34,
};

type Recorded = Parameters<VocabularyBookDeps["recordUsage"]>[0];

function setup(
  user: AuthenticatedUser | null,
  over: Partial<VocabularyBookDeps> = {},
) {
  const calls: unknown[][] = [];
  const recorded: Recorded[] = [];
  const logged: string[][] = [];
  const draftCalls: string[][] = [];
  const deps: VocabularyBookDeps = {
    currentUser: async () => user,
    store: {
      async list(ownerId) {
        calls.push(["list", ownerId]);
        return [entry];
      },
      async save(ownerId, value) {
        calls.push(["save", ownerId, value]);
        return entry;
      },
      async remove(ownerId, id) {
        calls.push(["remove", ownerId, id]);
      },
    },
    draft: async (word, sentence, onUsage) => {
      draftCalls.push([word, sentence]);
      onUsage(usage);
      return drafted;
    },
    recordUsage: async (value) => {
      recorded.push(value);
    },
    logError: (...args) => {
      logged.push(args);
    },
    ...over,
  };
  return {
    book: createVocabularyBook(deps),
    calls,
    recorded,
    logged,
    draftCalls,
  };
}

test("reads and writes as the signed-in owner", async () => {
  const { book, calls } = setup(member);
  assert.deepEqual(await book.list(), [entry]);
  assert.deepEqual(await book.save(input), entry);
  await book.remove(entry.id);
  assert.deepEqual(calls, [
    ["list", "password:abc"],
    ["save", "password:abc", input],
    ["remove", "password:abc", entry.id],
  ]);
});

test("an admin acting as a member reads and writes the member's book", async () => {
  const { book, calls } = setup(actingAdmin);
  await book.list();
  await book.save(input);
  await book.remove(entry.id);
  assert.deepEqual(
    calls.map((call) => call[1]),
    ["password:abc", "password:abc", "password:abc"],
  );
});

test("refuses without a member or admin", async () => {
  const users: (AuthenticatedUser | null)[] = [
    null,
    { githubLogin: "guest", role: "guest" },
    { githubLogin: "", role: "revoked" },
  ];
  for (const user of users) {
    const { book, calls, draftCalls } = setup(user);
    await assert.rejects(book.list(), VocabularyForbiddenError);
    await assert.rejects(book.save(input), VocabularyForbiddenError);
    await assert.rejects(book.remove(entry.id), VocabularyForbiddenError);
    assert.deepEqual(await book.draft("学习", ""), {
      ok: false,
      reason: "forbidden",
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(draftCalls, []);
  }
});

test("a member's draft is returned and its usage recorded as theirs", async () => {
  const { book, recorded, draftCalls } = setup(member);
  assert.deepEqual(await book.draft("学习", "我在学习。"), {
    ok: true,
    draft: drafted,
  });
  assert.deepEqual(draftCalls, [["学习", "我在学习。"]]);
  assert.deepEqual(recorded, [
    { ownerId: "password:abc", feature: "vocabulary_draft", ...usage },
  ]);
});

test("the demo account cannot draft", async () => {
  const { book, draftCalls, recorded } = setup(demo);
  assert.deepEqual(await book.draft("学习", ""), {
    ok: false,
    reason: "forbidden",
  });
  assert.deepEqual(draftCalls, []);
  assert.deepEqual(recorded, []);
});

test("without OpenAI the draft is unavailable", async () => {
  const { book } = setup(member, { draft: undefined });
  assert.deepEqual(await book.draft("学习", ""), {
    ok: false,
    reason: "unavailable",
  });
});

test("usage is recorded under the actor", async () => {
  const { book, recorded } = setup(actingAdmin);
  assert.equal((await book.draft("学习", "")).ok, true);
  assert.deepEqual(recorded, [
    { ownerId: "10001", feature: "vocabulary_draft", ...usage },
  ]);
});

test("a failed draft still records usage and reports failed", async () => {
  class OpenAiError extends Error {
    override name = "OpenAiError";
  }
  const { book, recorded, logged } = setup(member, {
    draft: async (_word, _sentence, onUsage) => {
      onUsage(usage);
      throw new OpenAiError("OPENAI_INVALID_RESPONSE");
    },
  });
  assert.deepEqual(await book.draft("学习", "我在学习。"), {
    ok: false,
    reason: "failed",
  });
  assert.equal(recorded.length, 1);
  assert.deepEqual(logged, [["VOCABULARY_DRAFT_FAILED", "OpenAiError"]]);
});

test("a usage write failure does not change the draft", async () => {
  const { book, logged } = setup(member, {
    recordUsage: async () => {
      throw new TypeError("db down: password:abc");
    },
  });
  assert.deepEqual(await book.draft("学习", ""), { ok: true, draft: drafted });
  assert.deepEqual(logged, [
    ["AI_USAGE_NOT_RECORDED", "vocabulary_draft", "TypeError"],
  ]);
});

test("store errors propagate", async () => {
  const boom = new Error("db down");
  const { book } = setup(member, {
    store: {
      list: async () => {
        throw boom;
      },
      save: async () => {
        throw boom;
      },
      remove: async () => {
        throw boom;
      },
    },
  });
  await assert.rejects(book.list(), boom);
  await assert.rejects(book.save(input), boom);
  await assert.rejects(book.remove(entry.id), boom);
});
