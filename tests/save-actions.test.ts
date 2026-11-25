import assert from "node:assert/strict";
import { beforeEach, test, type TestContext } from "node:test";

import {
  VocabularyExistsError,
  VocabularyForbiddenError,
  VocabularyNotFoundError,
} from "../src/application/vocabulary/vocabulary-book";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import { VOCABULARY_LIMITS } from "../src/domain/vocabulary/vocabulary-entry";
import { actionUnauthorized } from "../src/presentation/controllers/action-state";
import { accountForbiddenMessage } from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";
import {
  installNextStubs,
  next,
  RedirectSignal,
  redirectOf,
  stubSource,
  writtenCookies,
} from "./helpers/next-stubs";

// The Server Actions the browser calls to save what a learner did: review
// answers, question notes, conversations, practice rounds and the vocabulary
// book, plus the two that build a practice. The controllers behind most of
// them have their own tests (review-actions, question-save-controller,
// conversation-controller, practice-round-controller); these cover what the
// actions add: that each is wired to the signed-in user and to its own store,
// the vocabulary actions' own checks and texts, and what is refreshed.

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
// What each store answers when a test does not say: the success of its call.
const defaults: Record<string, unknown> = {
  "reviews.answer": true,
  "questionNotes.save": "saved",
  "conversationNotes.save": "saved",
  "conversationNotes.remove": true,
  "prepositionRecords.save": "saved",
  "complementRecords.save": "saved",
};
const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return name in answers ? answers[name]!() : defaults[name];
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
const success = { status: "success", message: "" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const throws = (error: Error) => () => {
  throw error;
};

const reviewAnswer = {
  itemId: "cabcdefghijklmnopqrstuvwx",
  logId: ID,
  rating: 3,
} as const;
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

function captureErrors(t: TestContext) {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  return logged;
}

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

test("members and admins save through each action's own store, refreshing nothing", async () => {
  const { answerReviewAction } = await review();
  const { saveQuestionAction } = await question();
  const { saveConversationAction } = await conversation();
  const rounds = await practiceRecord();
  const started = new Date(round.startedAt);

  for (const allowed of [member, admin]) {
    user = allowed;
    calls = [];
    assert.deepEqual(await answerReviewAction(reviewAnswer), { ok: true });
    assert.deepEqual(await saveQuestionAction(questionNote), { ok: true });
    assert.deepEqual(await saveConversationAction(chat), { ok: true });
    assert.deepEqual(await rounds.savePrepositionRoundAction(round), {
      ok: true,
    });
    // Measure words and 了・过・着 share the complements' records.
    for (const mode of ["result", "verb", "measure", "aspect"] as const)
      assert.deepEqual(
        await rounds.saveComplementRoundAction({ ...round, mode }),
        { ok: true },
      );
    assert.deepEqual(calls, [
      ["reviews.answer", reviewAnswer],
      ["questionNotes.save", questionNote],
      ["conversationNotes.save", chat],
      ["prepositionRecords.save", { ...round, startedAt: started }],
      ...["result", "verb", "measure", "aspect"].map((mode) => [
        "complementRecords.save",
        { ...round, mode, startedAt: started },
      ]),
    ]);
  }
  // Saving must not re-render the page that is still open.
  assert.deepEqual(next.revalidated, []);
});

test("a preposition round is never saved as a complement round or the other way", async () => {
  const rounds = await practiceRecord();
  const malformed = { ok: false, message: "練習の記録の形式が不正です。" };

  // Complements need their mode; a mode that is not one is refused.
  assert.deepEqual(
    await rounds.saveComplementRoundAction(round as never),
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

  // A mode sent with a preposition round is dropped, not saved.
  await rounds.savePrepositionRoundAction({
    ...round,
    mode: "measure",
  } as never);
  assert.deepEqual(calls, [
    [
      "prepositionRecords.save",
      { ...round, startedAt: new Date(round.startedAt) },
    ],
  ]);
});

test("deleting a conversation goes back to the list, or stays with the error", async (t) => {
  const { deleteConversationAction } = await conversation();
  captureErrors(t);

  assert.deepEqual(await deleteConversationAction(idle, form({ id: "c1" })), {
    status: "error",
    message: "会話の形式または上限を確認してください。",
  });
  assert.deepEqual(calls, []);

  // Someone else's, or already deleted.
  answers["conversationNotes.remove"] = () => false;
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

test("a vocabulary draft is asked for the trimmed word and says why it could not be made", async (t) => {
  const { draftVocabularyAction } = await vocabulary();
  const logged = captureErrors(t);
  const input = { word: " 忙 ", sentence: " 我今天很忙 " };

  answers["vocabulary.draft"] = () => ({
    ok: true,
    draft: { pinyin: "máng", meaning: "忙しい" },
  });
  assert.deepEqual(await draftVocabularyAction(input), {
    ok: true,
    pinyin: "máng",
    meaning: "忙しい",
  });
  assert.deepEqual(calls, [["vocabulary.draft", "忙", "我今天很忙"]]);

  const message = async (answer: () => unknown) => {
    answers["vocabulary.draft"] = answer;
    const result = await draftVocabularyAction(input);
    assert.equal(result.ok, false);
    return (result as { message: string }).message;
  };
  const reason = (value: string) => () => ({ ok: false, reason: value });
  // Without OpenAI there is nothing to ask.
  assert.match(
    await message(reason("unavailable")),
    /AIの下書きは今は使えません/,
  );
  assert.match(await message(reason("failed")), /下書きを作れませんでした/);
  // The demo account has no AI.
  assert.equal(await message(reason("forbidden")), accountForbiddenMessage);
  assert.deepEqual(logged, []);
  assert.equal(
    await message(throws(new TypeError("db down"))),
    genericErrorMessage,
  );
  assert.deepEqual(logged, [["VOCABULARY_DRAFT_FAILED", "TypeError"]]);

  // Next's own redirect (to sign-in, say) goes through.
  answers["vocabulary.draft"] = throws(new RedirectSignal("/signin"));
  await assert.rejects(draftVocabularyAction(input), RedirectSignal);
});

test("a vocabulary draft is refused for a word outside 1 to 20 characters", async () => {
  const { draftVocabularyAction } = await vocabulary();
  const malformed = { ok: false, message: "語句は1〜20文字にしてください。" };

  for (const input of [
    { word: "", sentence: "" },
    { word: "   ", sentence: "" },
    { word: "字".repeat(VOCABULARY_LIMITS.word + 1), sentence: "" },
    { word: "忙", sentence: "文".repeat(VOCABULARY_LIMITS.sentence + 1) },
    { word: 1, sentence: "" },
    null,
  ])
    assert.deepEqual(await draftVocabularyAction(input as never), malformed);
  assert.deepEqual(calls, []);
});

test("a word is saved trimmed under its id, and the book is refreshed", async () => {
  const { saveVocabularyAction } = await vocabulary();

  for (const input of [
    { ...word, id: "w1" },
    // z.uuid() alone lets capitals through.
    { ...word, id: ID.toUpperCase() },
    { ...word, word: "" },
    { ...word, meaning: " " },
    { ...word, word: "字".repeat(VOCABULARY_LIMITS.word + 1) },
    { ...word, pinyin: "a".repeat(VOCABULARY_LIMITS.pinyin + 1) },
    { ...word, meaning: "意".repeat(VOCABULARY_LIMITS.meaning + 1) },
    { ...word, sourceEntryId: "../etc" },
  ]) {
    const result = await saveVocabularyAction(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.match(
      (result as { message: string }).message,
      /^語句は1〜20文字、意味は1〜200文字、ピンインは100文字以内/,
    );
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(next.revalidated, []);

  assert.deepEqual(
    await saveVocabularyAction({
      id: ID,
      word: " 忙 ",
      pinyin: " máng ",
      meaning: " 忙しい ",
      sourceEntryId: "c1abc",
    }),
    { ok: true },
  );
  assert.deepEqual(calls, [
    ["vocabulary.save", { ...word, sourceEntryId: "c1abc" }],
  ]);
  assert.deepEqual(next.revalidated, [["/vocabulary"]]);
});

test("a word that cannot be saved says why and refreshes nothing", async (t) => {
  const { saveVocabularyAction } = await vocabulary();
  const logged = captureErrors(t);
  const message = async (error: Error) => {
    answers["vocabulary.save"] = throws(error);
    const result = await saveVocabularyAction(word);
    assert.equal(result.ok, false);
    return (result as { message: string }).message;
  };

  assert.equal(
    await message(new VocabularyExistsError()),
    "この語句はすでに単語帳にあります。",
  );
  assert.equal(
    await message(new VocabularyNotFoundError()),
    "単語が見つかりません。",
  );
  // The demo account's book is read-only for some users; the book says so.
  assert.equal(
    await message(new VocabularyForbiddenError()),
    accountForbiddenMessage,
  );
  assert.deepEqual(logged, []);
  assert.equal(await message(new TypeError("db down 忙")), genericErrorMessage);
  assert.deepEqual(logged, [["VOCABULARY_SAVE_FAILED", "TypeError"]]);
  assert.deepEqual(next.revalidated, []);
});

test("a word is removed by its id, and the book is refreshed", async (t) => {
  const { deleteVocabularyAction } = await vocabulary();
  const logged = captureErrors(t);
  const notFound = { status: "error", message: "単語が見つかりません。" };

  for (const id of ["w1", ID.toUpperCase(), ""])
    assert.deepEqual(
      await deleteVocabularyAction(idle, form({ id })),
      notFound,
    );
  assert.deepEqual(await deleteVocabularyAction(idle, form({})), notFound);
  assert.deepEqual(calls, []);

  assert.deepEqual(
    await deleteVocabularyAction(idle, form({ id: ID })),
    success,
  );
  assert.deepEqual(calls, [["vocabulary.remove", ID]]);
  assert.deepEqual(next.revalidated, [["/vocabulary"]]);

  next.revalidated.length = 0;
  answers["vocabulary.remove"] = throws(new VocabularyNotFoundError());
  assert.deepEqual(
    await deleteVocabularyAction(idle, form({ id: ID })),
    notFound,
  );
  answers["vocabulary.remove"] = throws(new VocabularyForbiddenError());
  assert.deepEqual(
    await deleteVocabularyAction(idle, form({ id: ID })),
    actionUnauthorized,
  );
  assert.deepEqual(logged, []);
  answers["vocabulary.remove"] = throws(new TypeError("db down"));
  assert.deepEqual(await deleteVocabularyAction(idle, form({ id: ID })), {
    status: "error",
    message: genericErrorMessage,
  });
  assert.deepEqual(logged, [["VOCABULARY_DELETE_FAILED", "TypeError"]]);
  assert.deepEqual(next.revalidated, []);
});

test("the next practice round is built for anyone signed in, guests included", async () => {
  const { nextPracticeQuizAction } = await practiceQuiz();

  user = null;
  assert.deepEqual(await nextPracticeQuizAction("preposition", null), refused);

  user = guest;
  for (const kind of ["vocabulary", "complement:", "complement:nope", 1])
    assert.deepEqual(await nextPracticeQuizAction(kind as never, null), {
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
});

test("a level narrows the next round by the basis in the learner's cookie", async () => {
  const { nextPracticeQuizAction } = await practiceQuiz();
  const ids = async (level: unknown) => {
    const result = await nextPracticeQuizAction("measure-word", level as never);
    assert.ok(result.ok);
    return result.quiz.map((question) => question.id).sort();
  };

  // HSK 6 has fewer than 25 measure words either way, so a round is all of
  // them, and the two ways of deciding levels choose different ones.
  const curated = await ids(6);
  assert.ok(curated.length > 0 && curated.length < 25);
  next.cookies.set("zhuelog_hsk_basis", "official");
  const official = await ids(6);
  assert.ok(official.length > 0 && official.length < 25);
  assert.notDeepEqual(official, curated);
  // A cookie that names no basis is the default one.
  next.cookies.set("zhuelog_hsk_basis", "random");
  assert.deepEqual(await ids(6), curated);

  // A level that is not one is every question.
  assert.equal((await ids(9)).length, 25);
  assert.equal((await ids("x")).length, 25);
});

test("the HSK basis is kept in a cookie and only practice pages are returned to", async () => {
  const { setHskBasisAction } = await hskBasis();
  const back = async (fields: Record<string, string>) =>
    (await redirectOf(() => setHskBasisAction(form(fields)))).to;
  const YEAR = 60 * 60 * 24 * 365;

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
  assert.deepEqual(writtenCookies(), [
    ["zhuelog_hsk_basis", "official", YEAR],
    ["zhuelog_hsk_basis", "curated", YEAR],
    ["zhuelog_hsk_basis", "curated", YEAR],
  ]);
  assert.deepEqual(next.written[0]!.options, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
    maxAge: YEAR,
  });

  for (const returnTo of [
    "https://evil.example/practice/x",
    "//evil.example",
    "/practice/../admin/accounts",
    "/practice/measure-words?hsk=5&next=//evil.example",
    "/practice/measure-words?hsk=7",
    "/logs",
    "/practice/",
  ])
    assert.equal(await back({ basis: "official", returnTo }), "/practice");
});
