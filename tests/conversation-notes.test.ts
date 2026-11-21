import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ConversationForbiddenError,
  createConversationNotes,
  type ConversationNotesDeps,
} from "../src/application/chat/conversation-notes";
import type {
  ChatTurn,
  Conversation,
  ConversationSummary,
  SaveConversationInput,
} from "../src/domain/chat/conversation";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";

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
const demo: AuthenticatedUser = {
  githubLogin: "demo",
  githubId: "demo:1",
  role: "member",
  demo: true,
};
const guest: AuthenticatedUser = { githubLogin: "g", role: "guest" };
const noGithubId: AuthenticatedUser = { githubLogin: "x", role: "member" };

const chatModel = "gpt-test";
const now = new Date("2026-11-16T03:00:00.000Z");
const id = "0b7e3f5a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const summary: ConversationSummary = {
  id,
  title: "你好",
  modelName: chatModel,
  ended: false,
  createdAt: now,
  updatedAt: now,
};
const conversation: Conversation = {
  ...summary,
  messages: [
    { id: "m1", role: "user", text: "你好" },
    { id: "m2", role: "assistant", text: "你好！" },
  ],
};
const input: SaveConversationInput = {
  id,
  title: "  你好 ",
  modelName: chatModel,
  ended: false,
  createdAt: "2026-11-15T01:02:03.000Z",
  messages: conversation.messages,
};
const turns: ChatTurn[] = [
  { role: "user", text: " 你好 " },
  { role: "assistant", text: "你好！" },
  { role: "user", text: "谢谢\n" },
];

type Call = { method: string; args: unknown[] };

function setup(
  user: AuthenticatedUser | null,
  overrides: Partial<ConversationNotesDeps> & {
    saved?: boolean;
    removed?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const usage: Parameters<ConversationNotesDeps["recordUsage"]>[0][] = [];
  const logged: string[][] = [];
  const answered: { turns: readonly ChatTurn[]; signal: AbortSignal }[] = [];
  const deps: ConversationNotesDeps = {
    currentUser: async () => user,
    store: {
      async list(ownerId, limit) {
        calls.push({ method: "list", args: [ownerId, limit] });
        return [summary];
      },
      async get(ownerId, conversationId) {
        calls.push({ method: "get", args: [ownerId, conversationId] });
        return conversation;
      },
      async save(ownerId, saved, at) {
        calls.push({ method: "save", args: [ownerId, saved, at] });
        return overrides.saved ?? true;
      },
      async remove(ownerId, conversationId) {
        calls.push({ method: "remove", args: [ownerId, conversationId] });
        return overrides.removed ?? true;
      },
    },
    chatModel,
    answer: async function* (asked, signal, onUsage) {
      answered.push({ turns: asked, signal });
      yield "你";
      onUsage({ model: chatModel, inputTokens: 21, outputTokens: 43 });
      yield "好";
    },
    recordUsage: async (entry) => {
      usage.push(entry);
    },
    logError: (code, ...details) => logged.push([code, ...details]),
    now: () => now,
    ...overrides,
  };
  return {
    notes: createConversationNotes(deps),
    calls,
    usage,
    logged,
    answered,
  };
}

async function collect(pieces: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const piece of pieces) out.push(piece);
  return out;
}

async function chatWith(
  notes: ReturnType<typeof createConversationNotes>,
  asked: readonly ChatTurn[] = turns,
  signal = new AbortController().signal,
) {
  const found = await notes.chatter();
  assert.equal(found.ok, true);
  if (!found.ok) throw new Error("unreachable");
  return found.asker.ask(asked, signal);
}

test("conversations follow the signed-in owner and chats bill the actor", async () => {
  // A member: the conversations and the usage are the member's.
  {
    const { notes, calls, usage } = setup(member);
    assert.deepEqual(await notes.list(), {
      chatModel,
      conversations: [summary],
    });
    assert.deepEqual(await notes.get(id), conversation);
    assert.equal(await notes.save(input), "saved");
    assert.equal(await notes.remove(id), true);
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["password:abc", "password:abc", "password:abc", "password:abc"],
    );
    assert.deepEqual(calls[0].args, ["password:abc", 100]);
    assert.deepEqual(await collect(await chatWith(notes)), ["你", "好"]);
    assert.deepEqual(usage, [
      {
        ownerId: "password:abc",
        feature: "chat",
        model: chatModel,
        inputTokens: 21,
        outputTokens: 43,
      },
    ]);
  }

  // An admin acting as a member: the member's conversations, the admin's
  // usage.
  {
    const { notes, calls, usage } = setup(actingAdmin);
    await notes.list();
    await notes.get(id);
    await notes.save(input);
    await notes.remove(id);
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["password:abc", "password:abc", "password:abc", "password:abc"],
    );
    await collect(await chatWith(notes));
    assert.deepEqual(usage, [
      {
        ownerId: "10001",
        feature: "chat",
        model: chatModel,
        inputTokens: 21,
        outputTokens: 43,
      },
    ]);
  }

  // The demo reads, saves and removes its conversations but may not chat.
  {
    const { notes, calls, answered } = setup(demo);
    await notes.list();
    await notes.get(id);
    assert.equal(await notes.save(input), "saved");
    assert.equal(await notes.remove(id), true);
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["demo:1", "demo:1", "demo:1", "demo:1"],
    );
    assert.deepEqual(await notes.chatter(), { ok: false, reason: "demo" });
    assert.equal(answered.length, 0);
  }

  // Signed out, a guest or no githubId: nothing is read or asked.
  for (const [user, reason] of [
    [null, "signed-out"],
    [guest, "forbidden"],
    [noGithubId, "forbidden"],
  ] as const) {
    const { notes, calls, answered } = setup(user);
    assert.deepEqual(await notes.chatter(), { ok: false, reason });
    await assert.rejects(notes.list(), ConversationForbiddenError);
    await assert.rejects(notes.get(id), ConversationForbiddenError);
    await assert.rejects(notes.save(input), ConversationForbiddenError);
    await assert.rejects(notes.remove(id), ConversationForbiddenError);
    assert.equal(calls.length, 0);
    assert.equal(answered.length, 0);
  }
});

test("without OpenAI the conversations stay readable and removable", async () => {
  const { notes, calls } = setup(member, {
    chatModel: undefined,
    answer: undefined,
  });
  assert.deepEqual(await notes.list(), {
    chatModel: "",
    conversations: [summary],
  });
  assert.deepEqual(await notes.get(id), conversation);
  assert.deepEqual(await notes.chatter(), {
    ok: false,
    reason: "unavailable",
  });
  calls.length = 0;
  assert.equal(await notes.save(input), "unavailable");
  assert.equal(calls.length, 0);
  assert.equal(await notes.remove(id), true);
  assert.deepEqual(calls, [{ method: "remove", args: ["password:abc", id] }]);

  // A model without a way to answer is unavailable too.
  const noAnswer = setup(member, { answer: undefined });
  assert.deepEqual(await noAnswer.notes.chatter(), {
    ok: false,
    reason: "unavailable",
  });
});

test("ids of the wrong shape never reach the store", async () => {
  const { notes, calls } = setup(member);
  for (const bad of [id.toUpperCase(), "conversation", "", `${id}x`]) {
    assert.equal(await notes.get(bad), null);
    assert.equal(await notes.remove(bad), false);
  }
  assert.equal(calls.length, 0);
});

test("another owner's conversation id is a conflict", async () => {
  {
    const { notes, calls } = setup(member);
    assert.equal(await notes.save({ ...input, title: "   " }), "invalid");
    assert.equal(await notes.save({ ...input, id: "conversation" }), "invalid");
    assert.equal(calls.length, 0);
  }
  {
    const { notes } = setup(member, { saved: false });
    assert.equal(await notes.save(input), "conflict");
  }
  {
    let reads = 0;
    const { notes, calls } = setup(member, {
      now: () => {
        reads += 1;
        return now;
      },
    });
    assert.equal(await notes.save(input), "saved");
    assert.equal(reads, 1);
    assert.deepEqual(calls, [
      {
        method: "save",
        args: [
          "password:abc",
          {
            id,
            title: "你好",
            modelName: chatModel,
            ended: false,
            createdAt: new Date("2026-11-15T01:02:03.000Z"),
            messages: conversation.messages,
          },
          now,
        ],
      },
    ]);
  }
});

test("the turns go to OpenAI untrimmed with the caller's signal", async () => {
  const { notes, answered } = setup(member);
  const signal = new AbortController().signal;
  await collect(await chatWith(notes, turns, signal));
  assert.equal(answered.length, 1);
  assert.deepEqual(answered[0].turns, turns);
  assert.equal(answered[0].signal, signal);
});

test("chat usage is recorded before the answer ends, even when it fails", async () => {
  const failing = (code: string): ConversationNotesDeps["answer"] =>
    async function* (_turns, _signal, onUsage) {
      yield "你";
      onUsage({ model: chatModel, inputTokens: 5, outputTokens: 7 });
      throw new Error(code);
    };

  // The usage is written before the failure reaches the caller.
  {
    const order: string[] = [];
    const { notes, logged } = setup(member, {
      answer: failing("OPENAI_TIMEOUT"),
      recordUsage: async () => {
        order.push("recorded");
      },
    });
    await assert.rejects(
      (async () => {
        try {
          await collect(await chatWith(notes));
        } catch (error) {
          order.push("thrown");
          throw error;
        }
      })(),
      { message: "OPENAI_TIMEOUT" },
    );
    assert.deepEqual(order, ["recorded", "thrown"]);
    assert.deepEqual(logged, [["CHAT_FAILED", "OPENAI_TIMEOUT"]]);
  }

  // A message that is not a code is logged by the error's name only.
  {
    const { notes, logged } = setup(member, {
      answer: failing("secret chat text"),
    });
    await assert.rejects(collect(await chatWith(notes)));
    assert.deepEqual(logged, [["CHAT_FAILED", "Error"]]);
  }

  // A failed usage write changes nothing the user gets.
  {
    class DbDown extends Error {
      override name = "DbDown";
    }
    const { notes, logged } = setup(member, {
      recordUsage: async () => {
        throw new DbDown("connection string");
      },
    });
    assert.deepEqual(await collect(await chatWith(notes)), ["你", "好"]);
    assert.deepEqual(logged, [["AI_USAGE_NOT_RECORDED", "chat", "DbDown"]]);
  }

  // An answer the browser stopped is not logged as failed, but its usage
  // is still recorded.
  {
    const controller = new AbortController();
    const { notes, logged, usage } = setup(member, {
      answer: async function* (_turns, signal, onUsage) {
        yield "你";
        onUsage({ model: chatModel, inputTokens: 1, outputTokens: 2 });
        controller.abort();
        if (signal.aborted) throw new Error("OPENAI_REQUEST_FAILED");
      },
    });
    await assert.rejects(
      collect(await chatWith(notes, turns, controller.signal)),
    );
    assert.deepEqual(logged, []);
    assert.equal(usage.length, 1);
  }
});
