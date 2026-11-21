import assert from "node:assert/strict";
import { test } from "node:test";

import { notFound, redirect } from "next/navigation";

import { LearningForbiddenError } from "../src/application/learning/learning-notes";
import { loadOr } from "../src/presentation/controllers/load-or";

test("loadOr returns what loaded", async () => {
  assert.deepEqual(await loadOr("CODE", async () => [1, 2], null), [1, 2]);
});

test("loadOr falls back on any other failure and logs only its name", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const failure = Object.assign(new Error("relation does not exist: secret"), {
    name: "PrismaClientKnownRequestError",
  });
  for (const error of [failure, new LearningForbiddenError(), "odd"]) {
    const result = await loadOr(
      "LEARNING_ENTRIES_UNAVAILABLE",
      async () => {
        throw error;
      },
      [],
    );
    assert.deepEqual(result, []);
  }
  assert.deepEqual(logged, [
    ["LEARNING_ENTRIES_UNAVAILABLE", "PrismaClientKnownRequestError"],
    ["LEARNING_ENTRIES_UNAVAILABLE", "LearningForbiddenError"],
    ["LEARNING_ENTRIES_UNAVAILABLE", "string"],
  ]);
});

test("loadOr rethrows Next's redirect and notFound", async () => {
  for (const next of [() => redirect("/signin"), () => notFound()]) {
    let thrown: unknown;
    try {
      next();
    } catch (error) {
      thrown = error;
    }
    await assert.rejects(
      loadOr(
        "CODE",
        async () => {
          throw thrown;
        },
        null,
      ),
      (error) => error === thrown,
    );
  }
});
