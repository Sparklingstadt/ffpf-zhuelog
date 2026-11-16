import assert from "node:assert/strict";
import { test } from "node:test";

import { lowercaseUuid } from "../src/presentation/actions/vocabulary-id";

test("a lowercase uuid passes", () => {
  assert.equal(
    lowercaseUuid.safeParse("0b8f1c52-3a4e-4c1d-9f6a-1d2e3f4a5b6c").success,
    true,
  );
});

test("a uppercase uuid or a non-uuid is refused", () => {
  assert.equal(
    lowercaseUuid.safeParse("0B8F1C52-3A4E-4C1D-9F6A-1D2E3F4A5B6C").success,
    false,
  );
  assert.equal(lowercaseUuid.safeParse("not-a-uuid").success, false);
});
