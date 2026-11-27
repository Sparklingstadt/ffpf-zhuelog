import assert from "node:assert/strict";
import { test } from "node:test";

import { FOLLOW_TIMELINE_LIMIT } from "../src/domain/social/follow";

test("the follow timeline shows the newest 100 shared notes", () => {
  assert.equal(FOLLOW_TIMELINE_LIMIT, 100);
});
