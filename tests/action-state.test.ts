import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { redirect } from "next/navigation";

import { LearningForbiddenError } from "../src/application/learning/learning-notes";
import { GoApiError } from "../src/infrastructure/go-api/client";
import {
  actionSuccess,
  actionUnauthorized,
  attemptGo,
  attemptGoAction,
  attemptGoResult,
  goFailureMessage,
} from "../src/presentation/controllers/action-state";
import { accountForbiddenMessage } from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";

// Collects what the helper logs instead of printing it.
function captureErrors(t: TestContext) {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  return logged;
}

test("goFailureMessage shows Go's message for input the user can fix", (t) => {
  const logged = captureErrors(t);
  for (const status of [400, 409, 413])
    assert.equal(
      goFailureMessage(
        "CODE",
        new GoApiError(status, "invalid_request", "入力を確認してください。"),
      ),
      "入力を確認してください。",
    );
  assert.deepEqual(logged, []);
});

test("goFailureMessage hides other failures and logs only codes", (t) => {
  const logged = captureErrors(t);
  assert.equal(
    goFailureMessage("SAVE_FAILED", new GoApiError(500, "internal", "secret")),
    genericErrorMessage,
  );
  assert.equal(
    goFailureMessage(
      "SAVE_FAILED",
      new GoApiError(400, "not_user_facing", "detail"),
    ),
    genericErrorMessage,
  );
  assert.deepEqual(logged, [
    ["SAVE_FAILED", 500, "internal"],
    ["SAVE_FAILED", 400, "not_user_facing"],
  ]);
});

test("attemptGoAction turns Go failures into form states", async (t) => {
  captureErrors(t);
  assert.deepEqual(
    await attemptGoAction("C", async () => actionSuccess),
    actionSuccess,
  );
  assert.deepEqual(
    await attemptGoAction("C", async () => {
      throw new GoApiError(403, "forbidden");
    }),
    actionUnauthorized,
  );
  assert.deepEqual(
    await attemptGoAction("C", async () => {
      throw new GoApiError(502, "bad_gateway");
    }),
    { status: "error", message: genericErrorMessage },
  );
});

test("attemptGoResult returns ok, or a message for each Go failure", async (t) => {
  const logged = captureErrors(t);
  assert.deepEqual(await attemptGoResult("C", async () => {}), { ok: true });
  assert.deepEqual(
    await attemptGoResult("C", async () => {
      throw new GoApiError(403, "forbidden");
    }),
    { ok: false, message: accountForbiddenMessage },
  );
  assert.deepEqual(
    await attemptGoResult(
      "C",
      async () => {
        throw new GoApiError(404, "not_found");
      },
      { notFound: "見つかりません。" },
    ),
    { ok: false, message: "見つかりません。" },
  );
  assert.deepEqual(
    await attemptGoResult("SAVE_FAILED", async () => {
      throw new GoApiError(404, "not_found");
    }),
    { ok: false, message: genericErrorMessage },
  );
  assert.deepEqual(logged, [["SAVE_FAILED", 404, "not_found"]]);
});

// The error Next's redirect() throws, as the helpers see it.
function nextRedirect(): unknown {
  try {
    redirect("/signin");
  } catch (error) {
    return error;
  }
}

test("Go helpers rethrow Next's redirect", async () => {
  const thrown = nextRedirect();
  for (const run of [
    () =>
      attemptGoResult("C", async () => {
        throw thrown;
      }),
    () =>
      attemptGoAction("C", async () => {
        throw thrown;
      }),
    () =>
      attemptGo("C", async () => {
        throw thrown;
      }),
  ])
    await assert.rejects(run(), (error) => error === thrown);
});

test("Go helpers treat LearningForbiddenError as not allowed", async (t) => {
  const logged = captureErrors(t);
  const forbidden = async () => {
    throw new LearningForbiddenError();
  };
  assert.deepEqual(await attemptGoAction("C", forbidden), actionUnauthorized);
  assert.deepEqual(await attemptGo("C", forbidden), {
    ok: false,
    message: accountForbiddenMessage,
  });
  assert.deepEqual(await attemptGoResult("C", forbidden), {
    ok: false,
    message: accountForbiddenMessage,
  });
  assert.deepEqual(logged, []);
});

test("Go helpers give any other failure the generic text and log only its name", async (t) => {
  const logged = captureErrors(t);
  const failure = Object.assign(new Error("secret detail"), {
    name: "PrismaClientKnownRequestError",
  });
  const failing = async () => {
    throw failure;
  };
  assert.deepEqual(await attemptGoAction("NOTE_TRASH_FAILED", failing), {
    status: "error",
    message: genericErrorMessage,
  });
  assert.deepEqual(await attemptGo("ISSUE_FAILED", failing), {
    ok: false,
    message: genericErrorMessage,
  });
  assert.deepEqual(
    await attemptGoResult("SAVE_FAILED", async () => {
      throw "odd";
    }),
    { ok: false, message: genericErrorMessage },
  );
  assert.deepEqual(logged, [
    ["NOTE_TRASH_FAILED", "PrismaClientKnownRequestError"],
    ["ISSUE_FAILED", "PrismaClientKnownRequestError"],
    ["SAVE_FAILED", "string"],
  ]);
});

test("attemptGo returns the value, or a message for each Go failure", async (t) => {
  const logged = captureErrors(t);
  assert.deepEqual(await attemptGo("C", async () => 42), {
    ok: true,
    value: 42,
  });
  assert.deepEqual(
    await attemptGo("C", async () => {
      throw new GoApiError(403, "forbidden");
    }),
    { ok: false, message: accountForbiddenMessage },
  );
  assert.deepEqual(
    await attemptGo(
      "C",
      async () => {
        throw new GoApiError(404, "not_found");
      },
      { notFound: "ありません。" },
    ),
    { ok: false, message: "ありません。" },
  );
  assert.deepEqual(
    await attemptGo("ISSUE_FAILED", async () => {
      throw new GoApiError(500, "internal");
    }),
    { ok: false, message: genericErrorMessage },
  );
  assert.deepEqual(logged, [["ISSUE_FAILED", 500, "internal"]]);
});
