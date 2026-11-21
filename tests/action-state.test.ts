import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { redirect } from "next/navigation";

import { LearningForbiddenError } from "../src/application/learning/learning-notes";
import { ReviewForbiddenError } from "../src/application/review/review-queue";
import {
  actionSuccess,
  actionUnauthorized,
  attemptAction,
  attemptCall,
} from "../src/presentation/controllers/action-state";
import { accountForbiddenMessage } from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";

// Collects what the helper logs instead of printing it.
function captureErrors(t: TestContext) {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  return logged;
}

test("attemptAction turns failures into form states", async (t) => {
  const logged = captureErrors(t);
  assert.deepEqual(
    await attemptAction("C", async () => actionSuccess),
    actionSuccess,
  );
  assert.deepEqual(
    await attemptAction("C", async () => {
      throw new ReviewForbiddenError();
    }),
    actionUnauthorized,
  );
  assert.deepEqual(
    await attemptAction("C", async () => {
      throw new Error("db");
    }),
    { status: "error", message: genericErrorMessage },
  );
  assert.deepEqual(logged, [["C", "Error"]]);
});

// The error Next's redirect() throws, as the helpers see it.
function nextRedirect(): unknown {
  try {
    redirect("/signin");
  } catch (error) {
    return error;
  }
}

test("the helpers rethrow Next's redirect", async () => {
  const thrown = nextRedirect();
  for (const run of [
    () =>
      attemptAction("C", async () => {
        throw thrown;
      }),
    () =>
      attemptCall("C", async () => {
        throw thrown;
      }),
  ])
    await assert.rejects(run(), (error) => error === thrown);
});

test("the helpers treat LearningForbiddenError and ReviewForbiddenError as not allowed", async (t) => {
  const logged = captureErrors(t);
  for (const Forbidden of [LearningForbiddenError, ReviewForbiddenError]) {
    const forbidden = async () => {
      throw new Forbidden();
    };
    assert.deepEqual(await attemptAction("C", forbidden), actionUnauthorized);
    assert.deepEqual(await attemptCall("C", forbidden), {
      ok: false,
      message: accountForbiddenMessage,
    });
  }
  assert.deepEqual(logged, []);
});

test("the helpers give any other failure the generic text and log only its name", async (t) => {
  const logged = captureErrors(t);
  const failure = Object.assign(new Error("secret detail"), {
    name: "PrismaClientKnownRequestError",
  });
  const failing = async () => {
    throw failure;
  };
  assert.deepEqual(await attemptAction("NOTE_TRASH_FAILED", failing), {
    status: "error",
    message: genericErrorMessage,
  });
  assert.deepEqual(await attemptCall("ISSUE_FAILED", failing), {
    ok: false,
    message: genericErrorMessage,
  });
  assert.deepEqual(
    await attemptCall("SAVE_FAILED", async () => {
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

test("attemptCall returns the value, or a message for each failure", async (t) => {
  const logged = captureErrors(t);
  assert.deepEqual(await attemptCall("C", async () => 42), {
    ok: true,
    value: 42,
  });
  assert.deepEqual(
    await attemptCall("C", async () => {
      throw new LearningForbiddenError();
    }),
    { ok: false, message: accountForbiddenMessage },
  );
  assert.deepEqual(
    await attemptCall("ISSUE_FAILED", async () => {
      throw Object.assign(new Error("secret"), {
        name: "PrismaClientKnownRequestError",
      });
    }),
    { ok: false, message: genericErrorMessage },
  );
  assert.deepEqual(logged, [["ISSUE_FAILED", "PrismaClientKnownRequestError"]]);
});
