import assert from "node:assert/strict";
import { test } from "node:test";

import { reviewItemsToDelete } from "../src/infrastructure/prisma/learning-note-writes";

test("reviewItemsToDelete targets only the owner's entry review items", () => {
  const where = reviewItemsToDelete("password:a", ["x", "y"]);
  assert.deepEqual(where, {
    ownerId: "password:a",
    kind: "entry",
    targetId: { in: ["x", "y"] },
  });
  // A vocabulary card must never match.
  assert.notEqual(where.kind, "vocabulary");
});
