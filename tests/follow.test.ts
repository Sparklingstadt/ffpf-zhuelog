import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FOLLOW_TIMELINE_LIMIT,
  isMemberOwnerId,
} from "../src/domain/social/follow";

test("member owner ids are Go's", () => {
  for (const id of ["password:abc", "sid:cabc", "password:" + "a".repeat(64)]) {
    assert.equal(isMemberOwnerId(id), true, id);
  }
  for (const id of [
    "password:" + "a".repeat(65),
    "password:",
    "sid:",
    "github:1",
    "10001",
    "password:ABC",
    "password:a-b",
    "guest",
  ]) {
    assert.equal(isMemberOwnerId(id), false, id);
  }
  assert.equal(FOLLOW_TIMELINE_LIMIT, 100);
});
