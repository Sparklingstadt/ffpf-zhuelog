import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createQuestionNotes,
  QuestionForbiddenError,
  type QuestionNotesDeps,
} from "../src/application/chat/question-notes";
import type {
  QuestionNote,
  QuestionSummary,
  SaveQuestionInput,
} from "../src/domain/chat/question";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import type { OpenAiUsage } from "../src/domain/vocabulary/vocabulary-entry";

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

const chatModel = "gpt-test";
const now = new Date("2026-11-16T03:00:00.000Z");
const id = "0b7e3f5a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const summary: QuestionSummary = {
  id,
  question: "了 の使い方",
  modelName: chatModel,
  createdAt: now,
};
const note: QuestionNote = { ...summary, answer: "完了を表します。" };
const input: SaveQuestionInput = {
  id,
  question: "  了 の使い方 ",
  answer: " 完了を表します。\n",
};

type Call = { method: string; args: unknown[] };

function setup(
  user: AuthenticatedUser | null,
  overrides: Partial<QuestionNotesDeps> & { saved?: boolean } = {},
) {
  const calls: Call[] = [];
  const usage: Parameters<QuestionNotesDeps["recordUsage"]>[0][] = [];
  const logged: string[][] = [];
  const answered: { text: string; signal: AbortSignal }[] = [];
  const deps: QuestionNotesDeps = {
    currentUser: async () => user,
    store: {
      async list(ownerId, limit) {
        calls.push({ method: "list", args: [ownerId, limit] });
        return [summary];
      },
      async get(ownerId, noteId) {
        calls.push({ method: "get", args: [ownerId, noteId] });
        return note;
      },
      async save(ownerId, saved, modelName, at) {
        calls.push({ method: "save", args: [ownerId, saved, modelName, at] });
        return overrides.saved ?? true;
      },
    },
    chatModel,
    answer: async function* (text, signal, onUsage) {
      answered.push({ text, signal });
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
  return { notes: createQuestionNotes(deps), calls, usage, logged, answered };
}

async function collect(pieces: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const piece of pieces) out.push(piece);
  return out;
}

async function askWith(
  notes: ReturnType<typeof createQuestionNotes>,
  text = "了 の使い方",
  signal = new AbortController().signal,
) {
  const found = await notes.asker();
  assert.equal(found.ok, true);
  if (!found.ok) throw new Error("unreachable");
  return found.asker.ask(text, signal);
}

test("quick questions follow the signed-in owner and bill them", async () => {
  // A member: the notes and the usage are the member's.
  {
    const { notes, calls, usage } = setup(member);
    assert.deepEqual(await notes.list(), { chatModel, questions: [summary] });
    assert.deepEqual(await notes.get(id), note);
    assert.equal(await notes.save(input), "saved");
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["abc", "abc", "abc"],
    );
    assert.deepEqual(calls[0].args, ["abc", 100]);
    assert.deepEqual(await collect(await askWith(notes)), ["你", "好"]);
    assert.deepEqual(usage, [
      {
        ownerId: "abc",
        feature: "quick_question",
        model: chatModel,
        inputTokens: 21,
        outputTokens: 43,
      },
    ]);
  }

  // An admin impersonating a member is the member: their notes and their
  // usage (Task 7 of the Better Auth migration settles this).
  {
    const { notes, calls, usage } = setup(impersonated);
    await notes.list();
    await notes.get(id);
    await notes.save(input);
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["abc", "abc", "abc"],
    );
    await collect(await askWith(notes));
    assert.deepEqual(usage, [
      {
        ownerId: "abc",
        feature: "quick_question",
        model: chatModel,
        inputTokens: 21,
        outputTokens: 43,
      },
    ]);
  }

  // The demo reads and saves its notes but may not ask.
  {
    const { notes, calls, answered } = setup(demo);
    await notes.list();
    await notes.get(id);
    assert.equal(await notes.save(input), "saved");
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["demo1", "demo1", "demo1"],
    );
    assert.deepEqual(await notes.asker(), { ok: false, reason: "demo" });
    assert.equal(answered.length, 0);
  }

  // Signed out or a guest: nothing is read or asked.
  for (const [user, reason] of [
    [null, "signed-out"],
    [guest, "forbidden"],
  ] as const) {
    const { notes, calls, answered } = setup(user);
    assert.deepEqual(await notes.asker(), { ok: false, reason });
    await assert.rejects(notes.list(), QuestionForbiddenError);
    await assert.rejects(notes.get(id), QuestionForbiddenError);
    await assert.rejects(notes.save(input), QuestionForbiddenError);
    assert.equal(calls.length, 0);
    assert.equal(answered.length, 0);
  }
});

test("without OpenAI the notes stay readable", async () => {
  const { notes, calls } = setup(member, {
    chatModel: undefined,
    answer: undefined,
  });
  assert.deepEqual(await notes.list(), { chatModel: "", questions: [summary] });
  assert.deepEqual(await notes.get(id), note);
  assert.deepEqual(await notes.asker(), { ok: false, reason: "unavailable" });
  calls.length = 0;
  assert.equal(await notes.save(input), "unavailable");
  assert.equal(calls.length, 0);

  // A model without a way to answer is unavailable too.
  const noAnswer = setup(member, { answer: undefined });
  assert.deepEqual(await noAnswer.notes.asker(), {
    ok: false,
    reason: "unavailable",
  });
});

test("get of an id of the wrong shape is null without asking the store", async () => {
  const { notes, calls } = setup(member);
  for (const bad of [id.toUpperCase(), "question", "", `${id}x`])
    assert.equal(await notes.get(bad), null);
  assert.equal(calls.length, 0);
});

test("a note id saved with other content is a conflict", async () => {
  {
    const { notes, calls } = setup(member);
    assert.equal(await notes.save({ ...input, answer: "   " }), "invalid");
    assert.equal(await notes.save({ ...input, id: "question" }), "invalid");
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
          "abc",
          { id, question: "了 の使い方", answer: "完了を表します。" },
          chatModel,
          now,
        ],
      },
    ]);
  }
});

test("the question goes to OpenAI untrimmed with the caller's signal", async () => {
  const { notes, answered } = setup(member);
  const signal = new AbortController().signal;
  await collect(await askWith(notes, "  了？ ", signal));
  assert.equal(answered.length, 1);
  assert.equal(answered[0].text, "  了？ ");
  assert.equal(answered[0].signal, signal);
});

test("usage is recorded before the answer ends, even when it fails", async () => {
  const failing = (code: string): QuestionNotesDeps["answer"] =>
    async function* (_text, _signal, onUsage) {
      yield "你";
      onUsage({ model: chatModel, inputTokens: 5, outputTokens: 7 });
      throw new Error(code);
    };

  // The usage is written before the failure reaches the caller.
  {
    const order: string[] = [];
    const { notes, logged } = setup(member, {
      answer: failing("OPENAI_INCOMPLETE_RESPONSE"),
      recordUsage: async () => {
        order.push("recorded");
      },
    });
    await assert.rejects(
      (async () => {
        try {
          await collect(await askWith(notes));
        } catch (error) {
          order.push("thrown");
          throw error;
        }
      })(),
      { message: "OPENAI_INCOMPLETE_RESPONSE" },
    );
    assert.deepEqual(order, ["recorded", "thrown"]);
    assert.deepEqual(logged, [
      ["QUICK_QUESTION_FAILED", "OPENAI_INCOMPLETE_RESPONSE"],
    ]);
  }

  // A message that is not a code is logged by the error's name only.
  {
    const { notes, logged } = setup(member, {
      answer: failing("secret question text"),
    });
    await assert.rejects(collect(await askWith(notes)));
    assert.deepEqual(logged, [["QUICK_QUESTION_FAILED", "Error"]]);
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
    assert.deepEqual(await collect(await askWith(notes)), ["你", "好"]);
    assert.deepEqual(logged, [
      ["AI_USAGE_NOT_RECORDED", "quick_question", "DbDown"],
    ]);
  }

  // An answer the browser stopped is not logged as failed, but its usage
  // is still recorded.
  {
    const controller = new AbortController();
    const { notes, logged, usage } = setup(member, {
      answer: async function* (_text, signal, onUsage) {
        yield "你";
        onUsage({ model: chatModel, inputTokens: 1, outputTokens: 2 });
        controller.abort();
        if (signal.aborted) throw new Error("OPENAI_REQUEST_FAILED");
      },
    });
    await assert.rejects(
      collect(await askWith(notes, "了", controller.signal)),
    );
    assert.deepEqual(logged, []);
    assert.equal(usage.length, 1);
  }
});

test("a usage write that never finishes does not hold the answer", async () => {
  const { notes, logged } = setup(member, {
    recordUsage: () => new Promise<void>(() => {}),
    recordTimeoutMs: 5,
  });
  assert.deepEqual(await collect(await askWith(notes)), ["你", "好"]);
  assert.deepEqual(logged, [
    ["AI_USAGE_NOT_RECORDED", "quick_question", "TimeoutError"],
  ]);
});

test("stopping early records only the usage already reported", async () => {
  const { notes, usage } = setup(member);
  for await (const piece of await askWith(notes)) {
    assert.equal(piece, "你");
    break;
  }
  // The usage was reported after the first piece, which was never resumed.
  assert.deepEqual(usage, []);

  const reported = setup(member, {
    answer: async function* (_text, _signal, onUsage) {
      onUsage({
        model: chatModel,
        inputTokens: 3,
        outputTokens: 4,
      } satisfies OpenAiUsage);
      yield "你";
      yield "好";
    },
  });
  for await (const piece of await askWith(reported.notes)) {
    assert.equal(piece, "你");
    break;
  }
  assert.equal(reported.usage.length, 1);
});
