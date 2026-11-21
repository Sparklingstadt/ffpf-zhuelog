import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import { actionUnauthorized } from "../src/presentation/controllers/action-state";
import {
  installNextStubs,
  next,
  redirectOf,
  stubSource,
} from "./helpers/next-stubs";

// The Server Actions on learning notes and follows. The checks themselves are
// the controllers' (follow-controller, note-trash-controller and so on, each
// with its own tests); these cover what the actions add: which Go call runs,
// that the checked owner is never sent, and what is refreshed afterwards.

installNextStubs();

const member: AuthenticatedUser = {
  githubLogin: "taro",
  githubId: "password:c1abcdefghijklmnopqrstu",
  role: "member",
};

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
  const followee = form({ followeeId: "password:c2" });

  answers.follow = () => "followed";
  assert.deepEqual(await followMemberAction(idle, followee), success);
  assert.deepEqual(await unfollowMemberAction(idle, followee), success);
  // The Go API follows as the token's owner, so the follower is not sent.
  assert.deepEqual(calls, [
    ["follow", "password:c2"],
    ["unfollow", "password:c2"],
  ]);
  assert.deepEqual(next.revalidated, [["/follow"], ["/follow"]]);

  next.revalidated.length = 0;
  answers.follow = () => "self";
  assert.equal((await followMemberAction(idle, followee)).status, "error");
  user = null;
  assert.deepEqual(
    await followMemberAction(idle, followee),
    actionUnauthorized,
  );
  assert.deepEqual(
    await unfollowMemberAction(idle, followee),
    actionUnauthorized,
  );
  assert.deepEqual(next.revalidated, []);
});

test("sharing a note refreshes the notes and the follow page", async () => {
  const { shareLearningEntryAction } = await follows();
  const fields = form({ id: "c1note", shared: "true" });

  answers.setShared = () => true;
  assert.deepEqual(await shareLearningEntryAction(idle, fields), success);
  assert.deepEqual(calls, [["setShared", "c1note", true]]);
  assert.deepEqual(next.revalidated, [...notes, ["/follow"]]);

  // Not this member's note.
  next.revalidated.length = 0;
  answers.setShared = () => false;
  assert.equal((await shareLearningEntryAction(idle, fields)).status, "error");
  assert.deepEqual(next.revalidated, []);
});

test("a trashed note's page is replaced by its day's list", async () => {
  const { trashLearningEntryAction } = await trash();
  const fields = { id: "c1note", year: "2026", month: "10", day: "4" };

  answers.trash = () => true;
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

  // Already gone: the form shows it, and the page stays.
  next.revalidated.length = 0;
  answers.trash = () => false;
  assert.equal(
    (await trashLearningEntryAction(idle, form(fields))).status,
    "error",
  );
  assert.deepEqual(next.revalidated, []);
});

test("restoring, deleting for good and emptying the trash refresh the notes in place", async () => {
  const actions = await trash();
  const fields = form({ id: "c1note" });

  answers.restore = () => true;
  answers.purge = () => true;
  answers.emptyTrash = () => 3;
  assert.deepEqual(
    await actions.restoreLearningEntryAction(idle, fields),
    success,
  );
  assert.deepEqual(
    await actions.purgeLearningEntryAction(idle, fields),
    success,
  );
  assert.deepEqual(await actions.emptyLearningTrashAction(), success);
  assert.deepEqual(calls, [
    ["restore", "c1note"],
    ["purge", "c1note"],
    ["emptyTrash"],
  ]);
  assert.deepEqual(next.revalidated, [...notes, ...notes, ...notes]);

  next.revalidated.length = 0;
  user = null;
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

  answers.setInReview = () => true;
  assert.deepEqual(await setNoteReviewAction(idle, fields), success);
  assert.deepEqual(calls, [["setInReview", "c1note", true]]);
  assert.deepEqual(next.revalidated, [...notes, ["/review"], ["/"]]);

  next.revalidated.length = 0;
  answers.setInReview = () => false;
  assert.equal((await setNoteReviewAction(idle, fields)).status, "error");
  assert.deepEqual(next.revalidated, []);
});

test("an imported CSV refreshes the notes; a refused one refreshes nothing", async () => {
  const { importLearningCsvAction } = await csvImport();
  const file = new File(["原文,添削\n"], "learning.csv", { type: "text/csv" });

  answers.importCsv = () => 2;
  assert.deepEqual(
    await importLearningCsvAction(idle, form({ csvFile: file })),
    { status: "success", message: "2件の学習文を登録しました。" },
  );
  assert.deepEqual(calls, [["importCsv", file]]);
  assert.deepEqual(next.revalidated, notes);

  next.revalidated.length = 0;
  assert.equal((await importLearningCsvAction(idle, form({}))).status, "error");
  user = null;
  assert.equal(
    (await importLearningCsvAction(idle, form({ csvFile: file }))).status,
    "error",
  );
  assert.deepEqual(next.revalidated, []);
});
