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
