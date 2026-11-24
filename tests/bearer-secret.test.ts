import assert from "node:assert/strict";
import { test } from "node:test";

import { bearerMatches } from "../src/infrastructure/security/bearer-secret";

test('only "Bearer <CRON_SECRET>" passes', () => {
  const secret = "cron-secret-value";
  for (const header of [
    "Bearer cron-secret-value",
    "bearer cron-secret-value",
    "BEARER cron-secret-value",
  ])
    assert.equal(bearerMatches(header, secret), true, header);

  for (const header of [
    null,
    "",
    "Bearer",
    "Bearer ",
    "Basic cron-secret-value",
    "Bearer wrong",
    "Bearer cron-secret-value ",
    "Bearer  cron-secret-value",
    "cron-secret-value",
  ])
    assert.equal(bearerMatches(header, secret), false, String(header));

  for (const missing of [undefined, ""]) {
    assert.equal(bearerMatches("Bearer ", missing), false);
    assert.equal(bearerMatches("Bearer anything", missing), false);
    assert.equal(bearerMatches("Bearer undefined", missing), false);
  }
});

test("a header is compared as the bytes it carries", () => {
  // Node gives header values as one character per byte; the UTF-8 bytes of
  // the secret match it, as in Go.
  const secret = "秘密";
  const asHeader = Buffer.from(secret, "utf8").toString("latin1");
  assert.equal(bearerMatches(`Bearer ${asHeader}`, secret), true);
});
