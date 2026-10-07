import assert from "node:assert/strict";
import { test } from "node:test";

import {
  requestedRecordOwner,
  withRecordOwner,
} from "../src/presentation/presenters/record-owner-href";

const other = { kind: "other" as const, ownerId: "password:ckabc123" };

test("adds the user query only when viewing another owner", () => {
  assert.equal(
    withRecordOwner("/logs/2026/10/07", other),
    "/logs/2026/10/07?user=password%3Ackabc123",
  );
  assert.equal(
    withRecordOwner("/logs/2026/10/07", { kind: "self", ownerId: "1" }),
    "/logs/2026/10/07",
  );
});

test("keeps an existing query and the hash", () => {
  assert.equal(
    withRecordOwner("/logs?x=1#a", other),
    "/logs?x=1&user=password%3Ackabc123#a",
  );
  assert.equal(
    withRecordOwner("/logs#a", { kind: "other", ownerId: "219588180" }),
    "/logs?user=219588180#a",
  );
});

test("reads the first value of a repeated user query", () => {
  assert.equal(requestedRecordOwner(undefined), undefined);
  assert.equal(requestedRecordOwner("219588180"), "219588180");
  assert.equal(requestedRecordOwner(["a", "b"]), "a");
});
