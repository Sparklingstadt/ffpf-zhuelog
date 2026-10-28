import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lineLinkMessageUrl,
  normalizeLineOfficialAccountId,
} from "../src/domain/line/official-account";

test("LINE linking URL targets the official account with the exact code prefilled", () => {
  assert.equal(
    lineLinkMessageUrl("@393bohaw", "ABCD2345"),
    "https://line.me/R/oaMessage/%40393bohaw/?ABCD2345",
  );
  assert.equal(normalizeLineOfficialAccountId(" @393bohaw "), "@393bohaw");
});
test("invalid account IDs and malformed link codes cannot become QR destinations", () => {
  for (const id of [
    "",
    "393bohaw",
    "@account/path",
    "https://evil.test",
    "@id?x=1",
  ]) {
    assert.equal(lineLinkMessageUrl(id, "ABCD2345"), undefined);
  }
  for (const code of ["", "short", "ABCD0123", "ABCD2345?x=1"]) {
    assert.equal(lineLinkMessageUrl("@393bohaw", code), undefined);
  }
});
