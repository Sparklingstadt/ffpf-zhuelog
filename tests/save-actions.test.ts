import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  MAX_ANSWER_CHARS,
  MAX_QUESTION_CHARS,
} from "../src/domain/chat/question";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import { GoApiError } from "../src/infrastructure/go-api/client";
import { actionUnauthorized } from "../src/presentation/controllers/action-state";
import { accountForbiddenMessage } from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";
import {
  installNextStubs,
  next,
  redirectOf,
  stubSource,
} from "./helpers/next-stubs";

// The Server Actions the browser calls to save what a learner did: review
// answers, question notes, the vocabulary book, conversations and practice
// rounds, plus the two that build a practice. Members and admins only; the
// input's shape is checked before the Go API is called.

installNextStubs();

const admin: AuthenticatedUser = {
  githubLogin: "admin",
  githubId: "10001",
  role: "admin",
};
const member: AuthenticatedUser = {
  githubLogin: "taro",
  githubId: "password:c1abcdefghijklmnopqrstu",
  role: "member",
};
const guest: AuthenticatedUser = { githubLogin: "guest", role: "guest" };

let user: AuthenticatedUser | null = null;
let calls: unknown[][] = [];
let answers: Record<string, () => unknown> = {};
const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return answers[name]?.();
  };

stubSource("composition/identity-container", {
  getCurrentViewerUser: async () => user,
});
stubSource("composition/review-container", {
  reviews: { answer: record("reviews.answer") },
});
stubSource("composition/question-container", {
  questionNotes: { save: record("questionNotes.save") },
});
stubSource("composition/vocabulary-container", {
  vocabulary: {
    draft: record("vocabulary.draft"),
    save: record("vocabulary.save"),
    remove: record("vocabulary.remove"),
  },
});
stubSource("composition/chat-container", {
  conversationNotes: {
    save: record("conversationNotes.save"),
    remove: record("conversationNotes.remove"),
  },
});
stubSource("composition/practice-container", {
  prepositionRecords: { save: record("prepositionRecords.save") },
  complementRecords: { save: record("complementRecords.save") },
});

const review = () => import("../src/presentation/actions/review-actions");
const question = () => import("../src/presentation/actions/question-actions");
const vocabulary = () =>
  import("../src/presentation/actions/vocabulary-actions");
const conversation = () =>
  import("../src/presentation/actions/conversation-actions");
const practiceRecord = () =>
  import("../src/presentation/actions/practice-record-actions");
const practiceQuiz = () =>
  import("../src/presentation/actions/practice-quiz-actions");
const hskBasis = () => import("../src/presentation/actions/hsk-basis-actions");

const ID = "0b9f6a52-6d0e-4b7c-9c56-2f1f0a4f7d11";
const refused = { ok: false, message: accountForbiddenMessage };
const idle = { status: "idle", message: "" } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const fails =
  (status: number, code: string, message = "") =>
  () => {
    throw new GoApiError(status, code, message);
  };

const reviewAnswer = { itemId: "item-1", logId: ID, rating: 3 } as const;
const questionNote = { id: ID, question: "「了」はいつ使う？", answer: "…" };
const word = { id: ID, word: "忙", pinyin: "máng", meaning: "忙しい" };
const chat = {
  id: ID,
  title: "我今天很忙",
  modelName: "gpt-e2e",
  ended: false,
  createdAt: "2026-11-21T03:00:00.000Z",
  messages: [
    { id: "m1", role: "user" as const, text: "我今天很忙" },
    { id: "m2", role: "assistant" as const, text: "你好！" },
  ],
};
const round = {
  id: ID,
  startedAt: "2026-11-21T03:00:00.000Z",
  elapsedMs: 61_000,
  questions: [
    {
      id: "measure-01",
      answer: "本",
      noun: "书",
      prompt: "一＿书",
      misses: ["张"],
    },
  ],
};

beforeEach(() => {
  next.reset();
  user = member;
  calls = [];
  answers = {};
});

test("guests and signed-out visitors save nothing", async () => {
  const { answerReviewAction } = await review();
  const { saveQuestionAction } = await question();
  const vocab = await vocabulary();
  const chats = await conversation();
  const rounds = await practiceRecord();

  for (const visitor of [null, guest]) {
    user = visitor;
    assert.deepEqual(await answerReviewAction(reviewAnswer), refused);
    assert.deepEqual(await saveQuestionAction(questionNote), refused);
    assert.deepEqual(
      await vocab.draftVocabularyAction({ word: "忙", sentence: "" }),
      refused,
    );
    assert.deepEqual(await vocab.saveVocabularyAction(word), refused);
    assert.deepEqual(
      await vocab.deleteVocabularyAction(idle, form({ id: ID })),
      actionUnauthorized,
    );
    assert.deepEqual(await chats.saveConversationAction(chat), refused);
    assert.deepEqual(
      await chats.deleteConversationAction(idle, form({ id: ID })),
      actionUnauthorized,
    );
    assert.deepEqual(await rounds.savePrepositionRoundAction(round), refused);
    assert.deepEqual(
      await rounds.saveComplementRoundAction({ ...round, mode: "measure" }),
      refused,
    );
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(next.revalidated, []);
});

test("a review answer is checked for its shape, then applied", async () => {
  const { answerReviewAction } = await review();
  const malformed = { ok: false, message: "復習の回答の形式が不正です。" };

  for (const input of [
    { ...reviewAnswer, rating: 5 },
    { ...reviewAnswer, rating: "3" },
    { ...reviewAnswer, logId: "not-a-uuid" },
    { ...reviewAnswer, itemId: "" },
  ])
    assert.deepEqual(await answerReviewAction(input as never), malformed);
  assert.deepEqual(calls, []);

  assert.deepEqual(await answerReviewAction(reviewAnswer), { ok: true });
  assert.deepEqual(calls, [["reviews.answer", reviewAnswer]]);

  // The item was removed (a trashed note, a deleted word) while it was open.
  answers["reviews.answer"] = fails(404, "not_found");
  assert.deepEqual(await answerReviewAction(reviewAnswer), {
    ok: false,
    message: "この問題は復習の一覧にありません。",
  });
  // An admin answers their own queue too.
  user = admin;
  answers = {};
  assert.deepEqual(await answerReviewAction(reviewAnswer), { ok: true });
});

test("a question note is trimmed and kept within its lengths, counted in characters", async () => {
  const { saveQuestionAction } = await question();
  const malformed = { ok: false, message: "質問ノートの形式が不正です。" };

  for (const input of [
    { ...questionNote, id: "q1" },
    { ...questionNote, question: "   " },
    { ...questionNote, answer: "" },
    { ...questionNote, question: "あ".repeat(MAX_QUESTION_CHARS + 1) },
    { ...questionNote, answer: "あ".repeat(MAX_ANSWER_CHARS + 1) },
  ])
    assert.deepEqual(await saveQuestionAction(input), malformed);
  assert.deepEqual(calls, []);

  // One emoji is one character, though two UTF-16 units.
  const longest = "😀".repeat(MAX_QUESTION_CHARS);
  assert.deepEqual(
    await saveQuestionAction({ id: ID, question: ` ${longest} `, answer: "a" }),
    { ok: true },
  );
  assert.deepEqual(calls, [
    ["questionNotes.save", { id: ID, question: longest, answer: "a" }],
  ]);
});

test("a vocabulary draft says why it could not be made", async (t) => {
  const { draftVocabularyAction } = await vocabulary();
  t.mock.method(console, "error", () => {});
  const input = { word: " 忙 ", sentence: "我今天很忙" };

  answers["vocabulary.draft"] = () => ({ pinyin: "máng", meaning: "忙しい" });
  assert.deepEqual(await draftVocabularyAction(input), {
    ok: true,
    pinyin: "máng",
    meaning: "忙しい",
  });
  assert.deepEqual(calls, [["vocabulary.draft", "忙", "我今天很忙"]]);

  const message = async (status: number, code: string) => {
    answers["vocabulary.draft"] = fails(status, code);
    const result = await draftVocabularyAction(input);
    assert.equal(result.ok, false);
    return (result as { message: string }).message;
  };
  // Without OpenAI the route is not there.
  assert.match(await message(404, "not_found"), /AIの下書きは今は使えません/);
  assert.match(await message(405, "unknown"), /AIの下書きは今は使えません/);
  assert.match(await message(502, "bad_gateway"), /下書きを作れませんでした/);
  assert.equal(await message(403, "forbidden"), accountForbiddenMessage);
  assert.equal(await message(500, "internal"), genericErrorMessage);

  assert.deepEqual(await draftVocabularyAction({ word: "", sentence: "" }), {
    ok: false,
    message: "語句は1〜20文字にしてください。",
  });

  // Anything but a Go failure, such as the redirect to sign-in, goes through.
  answers["vocabulary.draft"] = () => {
    throw new Error("NEXT_REDIRECT");
  };
  await assert.rejects(draftVocabularyAction(input), /NEXT_REDIRECT/);
});

test("a word is saved and removed by its id, and the book is refreshed", async () => {
  const vocab = await vocabulary();

  for (const input of [
    { ...word, id: "w1" },
    { ...word, word: "" },
    { ...word, meaning: " " },
    { ...word, word: "字".repeat(21) },
    { ...word, sourceEntryId: "../etc" },
  ]) {
    const result = await vocab.saveVocabularyAction(input);
    assert.equal(result.ok, false);
  }
  assert.deepEqual(calls, []);

  assert.deepEqual(
    await vocab.saveVocabularyAction({ ...word, sourceEntryId: "c1abc" }),
    { ok: true },
  );
  assert.deepEqual(calls, [
    ["vocabulary.save", { ...word, sourceEntryId: "c1abc" }],
  ]);
  assert.deepEqual(next.revalidated, [["/vocabulary"]]);

  // Already in the book: the Go API's own message, and nothing refreshed.
  next.revalidated.length = 0;
  answers["vocabulary.save"] = fails(
    409,
    "vocabulary_exists",
    "この語句はもう単語帳にあります。",
  );
  assert.deepEqual(await vocab.saveVocabularyAction(word), {
    ok: false,
    message: "この語句はもう単語帳にあります。",
  });
  assert.deepEqual(next.revalidated, []);

  assert.deepEqual(
    await vocab.deleteVocabularyAction(idle, form({ id: "w1" })),
    { status: "error", message: "単語が見つかりません。" },
  );
  assert.deepEqual(await vocab.deleteVocabularyAction(idle, form({ id: ID })), {
    status: "success",
    message: "",
  });
  assert.deepEqual(calls.at(-1), ["vocabulary.remove", ID]);
  assert.deepEqual(next.revalidated, [["/vocabulary"]]);

  answers["vocabulary.remove"] = fails(403, "forbidden");
  assert.deepEqual(
    await vocab.deleteVocabularyAction(idle, form({ id: ID })),
    actionUnauthorized,
  );
});

test("a conversation is saved whole, with its dates as dates", async () => {
  const { saveConversationAction } = await conversation();
  const malformed = {
    ok: false,
    message: "会話の形式または上限を確認してください。",
  };

  for (const input of [
    { ...chat, id: "c1" },
    { ...chat, createdAt: "yesterday" },
    { ...chat, messages: [{ id: "m1", role: "system", text: "x" }] },
  ])
    assert.deepEqual(await saveConversationAction(input as never), malformed);
  assert.deepEqual(calls, []);

  const before = Date.now();
  assert.deepEqual(await saveConversationAction(chat), { ok: true });
  const [, saved] = calls[0] as [
    string,
    typeof chat & { createdAt: Date; updatedAt: Date },
  ];
  assert.deepEqual(saved.createdAt, new Date("2026-11-21T03:00:00.000Z"));
  assert.ok(saved.updatedAt.getTime() >= before);
  assert.deepEqual(saved.messages, chat.messages);
  // Saving must not re-render the chat that is still open.
  assert.deepEqual(next.revalidated, []);
});

test("deleting a conversation goes back to the list, or stays with the error", async (t) => {
  const { deleteConversationAction } = await conversation();
  t.mock.method(console, "error", () => {});

  assert.deepEqual(await deleteConversationAction(idle, form({ id: "c1" })), {
    status: "error",
    message: "会話の形式または上限を確認してください。",
  });

  answers["conversationNotes.remove"] = fails(500, "internal");
  assert.deepEqual(await deleteConversationAction(idle, form({ id: ID })), {
    status: "error",
    message: genericErrorMessage,
  });
  assert.deepEqual(next.revalidated, []);

  answers = {};
  const redirect = await redirectOf(() =>
    deleteConversationAction(idle, form({ id: ID })),
  );
  assert.equal(redirect.to, "/conversations");
  assert.deepEqual(calls.at(-1), ["conversationNotes.remove", ID]);
  assert.deepEqual(next.revalidated, [["/conversations", "layout"]]);
});

test("a practice round is saved under its own kind, with the start as a date", async () => {
  const rounds = await practiceRecord();
  const malformed = { ok: false, message: "練習の記録の形式が不正です。" };

  for (const input of [
    { ...round, id: "r1" },
    { ...round, elapsedMs: 1.5 },
    { ...round, startedAt: "today" },
    { ...round, questions: [{ answer: "本" }] },
  ])
    assert.deepEqual(
      await rounds.savePrepositionRoundAction(input as never),
      malformed,
    );
  assert.deepEqual(
    await rounds.saveComplementRoundAction({
      ...round,
      mode: "preposition",
    } as never),
    malformed,
  );
  assert.deepEqual(calls, []);

  const started = new Date("2026-11-21T03:00:00.000Z");
  assert.deepEqual(await rounds.savePrepositionRoundAction(round), {
    ok: true,
  });
  // Measure words and 了・过・着 share the complements' records.
  for (const mode of ["result", "verb", "measure", "aspect"] as const)
    assert.deepEqual(
      await rounds.saveComplementRoundAction({ ...round, mode }),
      {
        ok: true,
      },
    );
  assert.deepEqual(calls, [
    ["prepositionRecords.save", { ...round, startedAt: started }],
    ...["result", "verb", "measure", "aspect"].map((mode) => [
      "complementRecords.save",
      { ...round, mode, startedAt: started },
    ]),
  ]);
  assert.deepEqual(next.revalidated, []);
});

test("the next practice round is built for anyone signed in, guests included", async () => {
  const { nextPracticeQuizAction } = await practiceQuiz();

  user = null;
  assert.deepEqual(await nextPracticeQuizAction("preposition", null), refused);

  user = guest;
  assert.deepEqual(await nextPracticeQuizAction("vocabulary" as never, null), {
    ok: false,
    message: "練習の種類が正しくありません。",
  });
  for (const kind of [
    "preposition",
    "measure-word",
    "aspect-particle",
    "complement:result",
  ] as const) {
    const result = await nextPracticeQuizAction(kind, null);
    assert.ok(result.ok, kind);
    assert.equal(result.quiz.length, 25, kind);
  }

  // A level narrows the round; one that is not a level is every question.
  const narrowed = await nextPracticeQuizAction("measure-word", 5);
  assert.ok(narrowed.ok && narrowed.quiz.length > 0);
  assert.ok(narrowed.ok && narrowed.quiz.length < 25);
  const unknown = await nextPracticeQuizAction("measure-word", 9 as never);
  assert.ok(unknown.ok && unknown.quiz.length === 25);
});

test("the HSK basis is kept in a cookie and only practice pages are returned to", async () => {
  const { setHskBasisAction } = await hskBasis();
  const back = async (fields: Record<string, string>) =>
    (await redirectOf(() => setHskBasisAction(form(fields)))).to;

  assert.equal(
    await back({
      basis: "official",
      returnTo: "/practice/measure-words?hsk=5",
    }),
    "/practice/measure-words?hsk=5",
  );
  assert.equal(
    await back({ basis: "curated", returnTo: "/practice/complements/verb" }),
    "/practice/complements/verb",
  );
  // Anything that is not one of the two bases is the default.
  assert.equal(await back({ basis: "random" }), "/practice");
  assert.deepEqual(
    next.written.map((cookie) => [cookie.name, cookie.value]),
    [
      ["zhuelog_hsk_basis", "official"],
      ["zhuelog_hsk_basis", "curated"],
      ["zhuelog_hsk_basis", "curated"],
    ],
  );
  assert.equal(next.written[0]!.options.httpOnly, true);

  for (const returnTo of [
    "https://evil.example/practice/x",
    "//evil.example",
    "/practice/../admin/accounts",
    "/practice/measure-words?hsk=5&next=//evil.example",
    "/logs",
    "/practice/",
  ])
    assert.equal(await back({ basis: "official", returnTo }), "/practice");
});
