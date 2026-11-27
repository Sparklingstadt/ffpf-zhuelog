import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { redirect } from "next/navigation";

import { LearningForbiddenError } from "../src/application/learning/learning-notes";
import { SocialForbiddenError } from "../src/application/social/social-network";
import type { FollowResult } from "../src/domain/social/follow";
import {
  handleFollow,
  handleShare,
  handleUnfollow,
} from "../src/presentation/controllers/follow-controller";

const success = { status: "success", message: "" };
const unauthorized = { status: "error", message: "ログインし直してください。" };
const notFound = {
  status: "error",
  message: "見つかりませんでした。画面を更新してください。",
};
const selfFollow = {
  status: "error",
  message: "自分はフォローできません。",
};
const failed = {
  status: "error",
  message: "処理できませんでした。時間をおいてもう一度お試しください。",
};

function form(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

function recorder<T>(result: T | Error) {
  const calls: unknown[][] = [];
  return {
    calls,
    run: async (...args: unknown[]) => {
      calls.push(args);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const admin = async () => ({ userId: "219588180", role: "admin" as const });
const member = async () => ({ userId: "ckm", role: "member" as const });

// The error Next's redirect() throws.
function nextRedirect(): Error {
  try {
    redirect("/signin");
  } catch (error) {
    return error as Error;
  }
}

function silenceConsoleError(t: TestContext) {
  return t.mock.method(console, "error", () => {});
}

test("follow uses the signed-in follower, never one from the form", async () => {
  const { calls, run } = recorder<FollowResult>("followed");
  const state = await handleFollow(
    form({ followeeId: "ckb1", followerId: "evil" }),
    { getMember: admin, run },
  );
  assert.deepEqual(state, success);
  assert.deepEqual(calls, [["219588180", "ckb1"]]);
});

test("follow and unfollow pass the user ids on", async () => {
  const followed = recorder<FollowResult>("followed");
  assert.deepEqual(
    await handleFollow(form({ followeeId: "cabc" }), {
      getMember: member,
      run: followed.run,
    }),
    success,
  );
  assert.deepEqual(followed.calls, [["ckm", "cabc"]]);
  const unfollowed = recorder<void>(undefined);
  assert.deepEqual(
    await handleUnfollow(form({ followeeId: "cabc" }), {
      getMember: async () => ({ userId: "cme", role: "member" }),
      run: unfollowed.run,
    }),
    success,
  );
  assert.deepEqual(unfollowed.calls, [["cme", "cabc"]]);
});

test("follow maps self and not-found to their messages", async () => {
  for (const [result, expected] of [
    ["self", selfFollow],
    ["not-found", notFound],
  ] as const) {
    const { run } = recorder<FollowResult>(result);
    assert.deepEqual(
      await handleFollow(form({ followeeId: "ckb1" }), {
        getMember: member,
        run,
      }),
      expected,
    );
  }
});

test("follow rejects a malformed followee without calling run", async () => {
  for (const followeeId of [
    "password:ckb1",
    "sid:cabc",
    "../x",
    "",
    "a b",
    "a".repeat(65),
  ]) {
    const { calls, run } = recorder<FollowResult>("followed");
    assert.deepEqual(
      await handleFollow(form({ followeeId }), { getMember: member, run }),
      notFound,
      followeeId,
    );
    assert.deepEqual(calls, []);
  }
  const { calls, run } = recorder<FollowResult>("followed");
  assert.deepEqual(
    await handleFollow(new FormData(), { getMember: member, run }),
    notFound,
  );
  assert.deepEqual(calls, []);
});

test("follow and share without a session ask to sign in again", async () => {
  for (const getMember of [async () => null]) {
    const follow = recorder<FollowResult>("followed");
    assert.deepEqual(
      await handleFollow(form({ followeeId: "ckb1" }), {
        getMember,
        run: follow.run,
      }),
      unauthorized,
    );
    assert.deepEqual(follow.calls, []);

    const unfollow = recorder<void>(undefined);
    assert.deepEqual(
      await handleUnfollow(form({ followeeId: "ckb1" }), {
        getMember,
        run: unfollow.run,
      }),
      unauthorized,
    );
    assert.deepEqual(unfollow.calls, []);
  }

  const share = recorder(true);
  assert.deepEqual(
    await handleShare(form({ id: "cmabc123", shared: "true" }), {
      getMember: async () => null,
      run: share.run,
    }),
    unauthorized,
  );
  assert.deepEqual(share.calls, []);
});

test("a failing follow logs only FOLLOW_FAILED and the error's name", async (t) => {
  const logged = silenceConsoleError(t);
  const { run } = recorder<FollowResult>(new Error("down"));
  assert.deepEqual(
    await handleFollow(form({ followeeId: "ckb1" }), {
      getMember: member,
      run,
    }),
    failed,
  );
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual(logged.mock.calls[0].arguments, ["FOLLOW_FAILED", "Error"]);
});

test("a failing unfollow logs only FOLLOW_FAILED and the error's name", async (t) => {
  const logged = silenceConsoleError(t);
  const { run } = recorder<void>(new Error("down"));
  assert.deepEqual(
    await handleUnfollow(form({ followeeId: "ckb1" }), {
      getMember: member,
      run,
    }),
    failed,
  );
  assert.deepEqual(logged.mock.calls[0].arguments, ["FOLLOW_FAILED", "Error"]);
});

test("follow and unfollow treat SocialForbiddenError as not allowed and let Next's redirect through", async () => {
  const forbidden = new SocialForbiddenError();
  assert.deepEqual(
    await handleFollow(form({ followeeId: "ckb1" }), {
      getMember: member,
      run: recorder<FollowResult>(forbidden).run,
    }),
    unauthorized,
  );
  assert.deepEqual(
    await handleUnfollow(form({ followeeId: "ckb1" }), {
      getMember: member,
      run: recorder<void>(forbidden).run,
    }),
    unauthorized,
  );

  const thrown = nextRedirect();
  await assert.rejects(
    handleFollow(form({ followeeId: "ckb1" }), {
      getMember: member,
      run: recorder<FollowResult>(thrown).run,
    }),
    (error) => error === thrown,
  );
  await assert.rejects(
    handleUnfollow(form({ followeeId: "ckb1" }), {
      getMember: member,
      run: recorder<void>(thrown).run,
    }),
    (error) => error === thrown,
  );
});

test("unfollow uses the signed-in follower, never one from the form", async () => {
  const { calls, run } = recorder<void>(undefined);
  assert.deepEqual(
    await handleUnfollow(form({ followeeId: "ckb1", followerId: "evil" }), {
      getMember: admin,
      run,
    }),
    success,
  );
  assert.deepEqual(calls, [["219588180", "ckb1"]]);
});

test("unfollow treats a malformed followee as not found", async () => {
  const { calls, run } = recorder<void>(undefined);
  assert.deepEqual(
    await handleUnfollow(form({ followeeId: "../x" }), {
      getMember: member,
      run,
    }),
    notFound,
  );
  assert.deepEqual(calls, []);
});

test("share passes only the id and flag; admins are refused", async () => {
  const on = recorder(true);
  assert.deepEqual(
    await handleShare(
      form({ id: "cmabc123", shared: "true", ownerId: "evil" }),
      { getMember: member, run: on.run },
    ),
    success,
  );
  assert.deepEqual(on.calls, [["cmabc123", true]]);

  const off = recorder(true);
  assert.deepEqual(
    await handleShare(form({ id: "cmabc123", shared: "false" }), {
      getMember: member,
      run: off.run,
    }),
    success,
  );
  assert.deepEqual(off.calls, [["cmabc123", false]]);

  for (const fields of [
    { id: "cmabc123", shared: "yes" } as Record<string, string>,
    { id: "cmabc123", shared: "TRUE" },
    { id: "cmabc123", shared: "" },
    { id: "cmabc123" },
    { id: "../x", shared: "true" },
    { shared: "true" },
  ]) {
    const bad = recorder(true);
    assert.deepEqual(
      await handleShare(form(fields), { getMember: member, run: bad.run }),
      notFound,
      JSON.stringify(fields),
    );
    assert.deepEqual(bad.calls, []);
  }

  const refused = recorder(true);
  assert.deepEqual(
    await handleShare(form({ id: "cmabc123", shared: "true" }), {
      getMember: admin,
      run: refused.run,
    }),
    unauthorized,
  );
  assert.deepEqual(refused.calls, []);
});

test("share of a missing note is not found; a failure logs only SHARE_FAILED", async (t) => {
  const missing = recorder(false);
  assert.deepEqual(
    await handleShare(form({ id: "cmabc123", shared: "true" }), {
      getMember: member,
      run: missing.run,
    }),
    notFound,
  );

  const logged = silenceConsoleError(t);
  const { run } = recorder<boolean>(new Error("down"));
  assert.deepEqual(
    await handleShare(form({ id: "cmabc123", shared: "true" }), {
      getMember: member,
      run,
    }),
    failed,
  );
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual(logged.mock.calls[0].arguments, ["SHARE_FAILED", "Error"]);
});

test("share treats LearningForbiddenError as not allowed and lets Next's redirect through", async () => {
  for (const error of [
    // learningNotes refuses the demo account.
    new LearningForbiddenError(),
  ]) {
    const forbidden = recorder<boolean>(error);
    assert.deepEqual(
      await handleShare(form({ id: "cmabc123", shared: "true" }), {
        getMember: member,
        run: forbidden.run,
      }),
      unauthorized,
    );
  }

  const thrown = nextRedirect();
  const redirected = recorder<boolean>(thrown);
  await assert.rejects(
    handleShare(form({ id: "cmabc123", shared: "true" }), {
      getMember: member,
      run: redirected.run,
    }),
    (error) => error === thrown,
  );
});

test("follow and unfollow treat SocialForbiddenError as not allowed", async (t) => {
  const errors = silenceConsoleError(t);
  const following = recorder<FollowResult>(new SocialForbiddenError());
  assert.deepEqual(
    await handleFollow(form({ followeeId: "def" }), {
      getMember: member,
      run: following.run,
    }),
    unauthorized,
  );
  const unfollowing = recorder<void>(new SocialForbiddenError());
  assert.deepEqual(
    await handleUnfollow(form({ followeeId: "def" }), {
      getMember: member,
      run: unfollowing.run,
    }),
    unauthorized,
  );
  assert.equal(errors.mock.callCount(), 0);
});
