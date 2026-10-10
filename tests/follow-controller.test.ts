import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import type { FollowResult } from "@ffpf-zhuelog/core/application/social/use-cases/follow-member";
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

const admin = async () => ({ githubId: "219588180", role: "admin" as const });
const member = async () => ({
  githubId: "password:ckm",
  role: "member" as const,
});

function silenceConsoleError(t: TestContext) {
  return t.mock.method(console, "error", () => {});
}

test("follow uses the signed-in follower, never one from the form", async () => {
  const { calls, run } = recorder<FollowResult>("followed");
  const state = await handleFollow(
    form({ followeeId: "password:ckb1", followerId: "password:evil" }),
    { getMember: admin, run },
  );
  assert.deepEqual(state, success);
  assert.deepEqual(calls, [["219588180", "password:ckb1"]]);
});

test("follow maps self and not-found to their messages", async () => {
  for (const [result, expected] of [
    ["self", selfFollow],
    ["not-found", notFound],
  ] as const) {
    const { run } = recorder<FollowResult>(result);
    assert.deepEqual(
      await handleFollow(form({ followeeId: "password:ckb1" }), {
        getMember: member,
        run,
      }),
      expected,
    );
  }
});

test("follow rejects a malformed followee without calling run", async () => {
  for (const followeeId of ["219588180", "password:../x", "password:", ""]) {
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
  for (const getMember of [
    async () => null,
    async () => ({ role: "member" as const }),
  ]) {
    const follow = recorder<FollowResult>("followed");
    assert.deepEqual(
      await handleFollow(form({ followeeId: "password:ckb1" }), {
        getMember,
        run: follow.run,
      }),
      unauthorized,
    );
    assert.deepEqual(follow.calls, []);

    const unfollow = recorder(true);
    assert.deepEqual(
      await handleUnfollow(form({ followeeId: "password:ckb1" }), {
        getMember,
        run: unfollow.run,
      }),
      unauthorized,
    );
    assert.deepEqual(unfollow.calls, []);

    const share = recorder(true);
    assert.deepEqual(
      await handleShare(form({ id: "cmabc123", shared: "true" }), {
        getMember,
        run: share.run,
      }),
      unauthorized,
    );
    assert.deepEqual(share.calls, []);
  }
});

test("a failing follow logs only FOLLOW_FAILED", async (t) => {
  const logged = silenceConsoleError(t);
  const { run } = recorder<FollowResult>(new Error("connection refused"));
  assert.deepEqual(
    await handleFollow(form({ followeeId: "password:ckb1" }), {
      getMember: member,
      run,
    }),
    failed,
  );
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual(logged.mock.calls[0].arguments, ["FOLLOW_FAILED"]);
});

test("a failing unfollow logs only FOLLOW_FAILED", async (t) => {
  const logged = silenceConsoleError(t);
  const { run } = recorder<boolean>(new Error("connection refused"));
  assert.deepEqual(
    await handleUnfollow(form({ followeeId: "password:ckb1" }), {
      getMember: member,
      run,
    }),
    failed,
  );
  assert.deepEqual(logged.mock.calls[0].arguments, ["FOLLOW_FAILED"]);
});

test("unfollow succeeds even when there was nothing to remove", async () => {
  for (const removed of [true, false]) {
    const { calls, run } = recorder(removed);
    assert.deepEqual(
      await handleUnfollow(
        form({ followeeId: "password:ckb1", followerId: "password:evil" }),
        { getMember: admin, run },
      ),
      success,
    );
    assert.deepEqual(calls, [["219588180", "password:ckb1"]]);
  }
});

test("unfollow treats a malformed followee as not found", async () => {
  const { calls, run } = recorder(true);
  assert.deepEqual(
    await handleUnfollow(form({ followeeId: "../x" }), {
      getMember: member,
      run,
    }),
    notFound,
  );
  assert.deepEqual(calls, []);
});

test("share passes the owner, id and flag; admins are refused", async () => {
  const on = recorder(true);
  assert.deepEqual(
    await handleShare(
      form({ id: "cmabc123", shared: "true", ownerId: "password:evil" }),
      { getMember: member, run: on.run },
    ),
    success,
  );
  assert.deepEqual(on.calls, [["password:ckm", "cmabc123", true]]);

  const off = recorder(true);
  assert.deepEqual(
    await handleShare(form({ id: "cmabc123", shared: "false" }), {
      getMember: member,
      run: off.run,
    }),
    success,
  );
  assert.deepEqual(off.calls, [["password:ckm", "cmabc123", false]]);

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
  assert.deepEqual(logged.mock.calls[0].arguments, ["SHARE_FAILED"]);
});
