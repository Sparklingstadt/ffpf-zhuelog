import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { LearningForbiddenError } from "../src/application/learning/learning-notes";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import { actionUnauthorized } from "../src/presentation/controllers/action-state";
import {
  installNextStubs,
  next,
  redirectOf,
  stubSource,
} from "./helpers/next-stubs";

// The Server Actions on learning notes and follows. The checks themselves are
// the controllers' (follow-controller, note-trash-controller,
// note-review-controller, learning-csv-import, each with its own tests); these
// cover what the actions add: which call runs, that the checked follower is
// never sent, and what is refreshed or where the browser goes afterwards.

installNextStubs();

const member: AuthenticatedUser = {
  userId: "c1abcdefghijklmnopqrstu",
  role: "member",
  displayName: "taro",
  username: "taro",
};

let user: AuthenticatedUser | null = null;
let calls: unknown[][] = [];
let answers: Record<string, () => unknown> = {};
// What each call answers when a test does not say: its success.
const defaults: Record<string, unknown> = {
  follow: "followed",
  setShared: true,
  setInReview: true,
  trash: true,
  restore: true,
  purge: true,
  emptyTrash: 3,
  importCsv: { ok: true, count: 2 },
};
const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return name in answers ? answers[name]!() : defaults[name];
  };

stubSource("composition/identity-container", {
  getCurrentMemberUser: async () => user,
});
stubSource("composition/learning-container", {
  learningNotes: {
    setShared: record("setShared"),
    setInReview: record("setInReview"),
    trash: record("trash"),
    restore: record("restore"),
    purge: record("purge"),
    emptyTrash: record("emptyTrash"),
    importCsv: record("importCsv"),
  },
});
stubSource("composition/social-container", {
  socialNetwork: {
    follow: record("follow"),
    unfollow: record("unfollow"),
  },
});

const follows = () => import("../src/presentation/actions/follow-actions");
const trash = () => import("../src/presentation/actions/note-trash-actions");
const noteReview = () =>
  import("../src/presentation/actions/note-review-actions");
const csvImport = () =>
  import("../src/presentation/actions/import-learning-csv-action");

const idle = { status: "idle", message: "" } as const;
const success = { status: "success", message: "" };
const form = (fields: Record<string, string | Blob>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
// The notes refuse a user who may not act (a guest, the demo for sharing).
const refuses = () => {
  throw new LearningForbiddenError();
};
// What revalidateNotes() refreshes: the home page and every list of notes.
const notes = [["/"], ["/logs", "layout"]];

beforeEach(() => {
  next.reset();
  user = member;
  calls = [];
  answers = {};
});

test("following names only the member to follow and refreshes the follow page", async () => {
  const { followMemberAction, unfollowMemberAction } = await follows();
  const followee = form({ followeeId: "c2" });

  assert.deepEqual(await followMemberAction(idle, followee), success);
  assert.deepEqual(await unfollowMemberAction(idle, followee), success);
  // The follows are made as the signed-in user, so the follower is not sent.
  assert.deepEqual(calls, [
    ["follow", "c2"],
    ["unfollow", "c2"],
  ]);
  assert.deepEqual(next.revalidated, [["/follow"], ["/follow"]]);
});

test("a follow that is refused refreshes nothing", async () => {
  const { followMemberAction, unfollowMemberAction } = await follows();
  const followee = form({ followeeId: "c2" });

  answers.follow = () => "self";
  assert.equal((await followMemberAction(idle, followee)).status, "error");
  answers.follow = () => "not-found";
  assert.equal((await followMemberAction(idle, followee)).status, "error");
  assert.equal(
    (await followMemberAction(idle, form({ followeeId: "10001" }))).status,
    "error",
  );
  calls = [];

  user = null;
  assert.deepEqual(
    await followMemberAction(idle, followee),
    actionUnauthorized,
  );
  assert.deepEqual(
    await unfollowMemberAction(idle, followee),
    actionUnauthorized,
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(next.revalidated, []);
});

test("sharing a note refreshes the notes and the follow page", async () => {
  const { shareLearningEntryAction } = await follows();
  const fields = form({ id: "c1note", shared: "true" });

  assert.deepEqual(await shareLearningEntryAction(idle, fields), success);
  assert.deepEqual(
    await shareLearningEntryAction(
      idle,
      form({ id: "c1note", shared: "false" }),
    ),
    success,
  );
  assert.deepEqual(calls, [
    ["setShared", "c1note", true],
    ["setShared", "c1note", false],
  ]);
  assert.deepEqual(next.revalidated, [
    ...notes,
    ["/follow"],
    ...notes,
    ["/follow"],
  ]);

  // Not this member's note, the demo account, or nobody signed in.
  next.revalidated.length = 0;
  answers.setShared = () => false;
  assert.equal((await shareLearningEntryAction(idle, fields)).status, "error");
  answers.setShared = refuses;
  assert.deepEqual(
    await shareLearningEntryAction(idle, fields),
    actionUnauthorized,
  );
  user = null;
  assert.deepEqual(
    await shareLearningEntryAction(idle, fields),
    actionUnauthorized,
  );
  assert.deepEqual(next.revalidated, []);
});

test("a trashed note's page is replaced by its day's list", async () => {
  const { trashLearningEntryAction } = await trash();
  const fields = { id: "c1note", year: "2026", month: "10", day: "4" };

  const redirect = await redirectOf(() =>
    trashLearningEntryAction(idle, form(fields)),
  );
  assert.equal(redirect.to, "/logs/2026/10/4?trashed=1");
  // Going back must not reopen the number, which now belongs to another note.
  assert.equal(redirect.type, "replace");
  assert.deepEqual(calls, [["trash", "c1note"]]);
  assert.deepEqual(next.revalidated, notes);

  // The date is the form's: anything that is not a day is the list of dates.
  for (const day of ["32", "../../admin", ""])
    assert.equal(
      (
        await redirectOf(() =>
          trashLearningEntryAction(idle, form({ ...fields, day })),
        )
      ).to,
      "/logs",
    );
});

test("a note that cannot be trashed stays on its page and refreshes nothing", async () => {
  const { trashLearningEntryAction } = await trash();
  const fields = form({ id: "c1note", year: "2026", month: "10", day: "4" });

  // Already gone: the form shows it.
  answers.trash = () => false;
  assert.equal((await trashLearningEntryAction(idle, fields)).status, "error");
  // The notes themselves refuse a user who may not act; the action has no
  // check of its own to skip.
  answers.trash = refuses;
  assert.deepEqual(
    await trashLearningEntryAction(idle, fields),
    actionUnauthorized,
  );
  assert.equal(
    (
      await trashLearningEntryAction(
        idle,
        form({ id: "../x", year: "2026", month: "10", day: "4" }),
      )
    ).status,
    "error",
  );
  assert.deepEqual(next.revalidated, []);
});

test("restoring, deleting for good and emptying the trash refresh the notes in place", async () => {
  const actions = await trash();
  const fields = form({ id: "c1note" });

  assert.deepEqual(
    await actions.restoreLearningEntryAction(idle, fields),
    success,
  );
  assert.deepEqual(
    await actions.purgeLearningEntryAction(idle, fields),
    success,
  );
  assert.deepEqual(await actions.emptyLearningTrashAction(), success);
  // Each button runs its own call: deleting for good is never a restore.
  assert.deepEqual(calls, [
    ["restore", "c1note"],
    ["purge", "c1note"],
    ["emptyTrash"],
  ]);
  assert.deepEqual(next.revalidated, [...notes, ...notes, ...notes]);

  next.revalidated.length = 0;
  for (const name of ["restore", "purge", "emptyTrash"])
    answers[name] = refuses;
  assert.deepEqual(
    await actions.restoreLearningEntryAction(idle, fields),
    actionUnauthorized,
  );
  assert.deepEqual(
    await actions.purgeLearningEntryAction(idle, fields),
    actionUnauthorized,
  );
  assert.deepEqual(
    await actions.emptyLearningTrashAction(),
    actionUnauthorized,
  );
  assert.deepEqual(next.revalidated, []);
});

test("putting a note in review refreshes the notes, the queue and the home page's count", async () => {
  const { setNoteReviewAction } = await noteReview();
  const fields = form({ id: "c1note", inReview: "true" });

  assert.deepEqual(await setNoteReviewAction(idle, fields), success);
  assert.deepEqual(calls, [["setInReview", "c1note", true]]);
  assert.deepEqual(next.revalidated, [...notes, ["/review"], ["/"]]);

  next.revalidated.length = 0;
  answers.setInReview = () => false;
  assert.equal((await setNoteReviewAction(idle, fields)).status, "error");
  user = null;
  assert.deepEqual(await setNoteReviewAction(idle, fields), actionUnauthorized);
  assert.deepEqual(next.revalidated, []);
});

test("an imported CSV refreshes the notes; a refused one refreshes nothing", async () => {
  const { importLearningCsvAction } = await csvImport();
  const file = new File(["原文,添削\n"], "learning.csv", { type: "text/csv" });

  assert.deepEqual(
    await importLearningCsvAction(idle, form({ csvFile: file })),
    { status: "success", message: "2件の学習文を登録しました。" },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0], "importCsv");
  assert.equal((calls[0]![1] as File).name, "learning.csv");
  assert.deepEqual(next.revalidated, notes);

  next.revalidated.length = 0;
  calls = [];
  answers.importCsv = () => ({ ok: false, message: "3列未満の行があります。" });
  assert.deepEqual(
    await importLearningCsvAction(idle, form({ csvFile: file })),
    { status: "error", message: "3列未満の行があります。" },
  );
  assert.equal((await importLearningCsvAction(idle, form({}))).status, "error");
  user = null;
  assert.equal(
    (await importLearningCsvAction(idle, form({ csvFile: file }))).status,
    "error",
  );
  // Only the first of the three reached the import.
  assert.equal(calls.length, 1);
  assert.deepEqual(next.revalidated, []);
});
