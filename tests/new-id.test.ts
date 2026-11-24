import assert from "node:assert/strict";
import { test } from "node:test";

import { newId } from "../src/infrastructure/prisma/new-id";

test("review item ids are c and 24 of a-z0-9", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i += 1) {
    const id = newId();
    assert.match(id, /^c[a-z0-9]{24}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 1000);
});
