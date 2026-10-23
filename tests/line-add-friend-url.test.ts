import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { lineAddFriendUrl } from "../src/infrastructure/config/environment";

const original = process.env.LINE_ADD_FRIEND_URL;
afterEach(() => {
  if (original === undefined) delete process.env.LINE_ADD_FRIEND_URL;
  else process.env.LINE_ADD_FRIEND_URL = original;
});

test("lineAddFriendUrl accepts only https URLs", () => {
  process.env.LINE_ADD_FRIEND_URL = " https://line.me/R/ti/p/@example ";
  assert.equal(lineAddFriendUrl(), "https://line.me/R/ti/p/@example");

  for (const value of [
    "http://line.me/R/ti/p/@example",
    "javascript:alert(1)",
    "line.me/R/ti/p/@example",
    "",
  ]) {
    process.env.LINE_ADD_FRIEND_URL = value;
    assert.equal(lineAddFriendUrl(), undefined, value);
  }

  delete process.env.LINE_ADD_FRIEND_URL;
  assert.equal(lineAddFriendUrl(), undefined);
});
