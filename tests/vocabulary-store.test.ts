import assert from "node:assert/strict";
import { test } from "node:test";

import { decideSave } from "../src/infrastructure/prisma/vocabulary-store";

test("another owner's id is not found", () => {
  assert.equal(decideSave("password:other", "password:me"), "not-found");
});

test("an unknown id is created and the owner's own id is updated", () => {
  assert.equal(decideSave(null, "password:me"), "create");
  assert.equal(decideSave("password:me", "password:me"), "update");
});

import { uniqueViolationOn } from "../src/infrastructure/prisma/vocabulary-store";

const p2002 = (meta: unknown) => ({ code: "P2002", meta });

test("a unique violation is told apart by its constraint, in every meta shape", () => {
  assert.equal(
    uniqueViolationOn(p2002({ target: ["ownerId", "language", "word"] })),
    "word",
  );
  assert.equal(
    uniqueViolationOn(
      p2002({ target: "VocabularyEntry_ownerId_language_word_key" }),
    ),
    "word",
  );
  assert.equal(uniqueViolationOn(p2002({ target: ["id"] })), "id");
  assert.equal(
    uniqueViolationOn(p2002({ target: "VocabularyEntry_pkey" })),
    "id",
  );
  assert.equal(
    uniqueViolationOn(
      p2002({
        driverAdapterError: {
          cause: { constraint: { fields: ["ownerId", "language", "word"] } },
        },
      }),
    ),
    "word",
  );
  assert.equal(
    uniqueViolationOn(
      p2002({
        driverAdapterError: { cause: { constraint: { fields: ["id"] } } },
      }),
    ),
    "id",
  );
  assert.equal(
    uniqueViolationOn(
      p2002({
        driverAdapterError: {
          cause: { constraint: { index: "VocabularyEntry_pkey" } },
        },
      }),
    ),
    "id",
  );
  assert.equal(uniqueViolationOn(p2002({})), "other");
  assert.equal(uniqueViolationOn({ code: "P2025" }), null);
  assert.equal(uniqueViolationOn(new Error("x")), null);
});
