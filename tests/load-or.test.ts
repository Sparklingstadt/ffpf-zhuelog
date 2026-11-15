import assert from "node:assert/strict";
import { test } from "node:test";

import { GoApiError } from "../src/infrastructure/go-api/client";
import { loadOr } from "../src/presentation/controllers/load-or";

test("loadOr returns what loaded", async () => {
  assert.deepEqual(await loadOr("CODE", async () => [1, 2], null), [1, 2]);
});

test("loadOr falls back on a Go failure and logs only its codes", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const result = await loadOr(
    "VOCABULARY_UNAVAILABLE",
    async () => {
      throw new GoApiError(503, "unavailable", "detail");
    },
    null,
  );
  assert.equal(result, null);
  assert.deepEqual(logged, [["VOCABULARY_UNAVAILABLE", 503, "unavailable"]]);
});

test("loadOr rethrows anything else, such as Next's redirect", async () => {
  const redirect = new Error("NEXT_REDIRECT");
  await assert.rejects(
    loadOr(
      "CODE",
      async () => {
        throw redirect;
      },
      null,
    ),
    redirect,
  );
});
