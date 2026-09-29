import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createIntegrationRegistry,
  defineIntegration,
  type Integration,
} from "@ffpf-zhuelog/core/integration";

function sample(id: string): Integration {
  return defineIntegration({
    id,
    text: {
      navLabel: "Sample list",
      title: "Sample title",
      description: "Sample description",
      listTitle: "Sample items",
      listDescription: "Sample item description",
      sources: ["Sample source"],
      emptyMessage: "Nothing yet",
      downloadLabel: "Download sample",
    },
    preview: () => ({ stats: [], items: [] }),
    export: () => null,
  });
}

test("registry lists integrations in registration order and finds them by id", () => {
  const first = sample("sample");
  const second = sample("other-2");
  const registry = createIntegrationRegistry([first, second]);
  assert.deepEqual(registry.list(), [first, second]);
  assert.equal(registry.find("sample"), first);
  assert.equal(registry.find("other-2"), second);
});

test("registry rejects ids that are not lowercase URL slugs of at most 40 characters", () => {
  for (const id of [
    "",
    "Sample",
    "-sample",
    "sample-",
    "sam--ple",
    "has space",
    "snake_case",
    "日本語",
    "a".repeat(41),
  ]) {
    assert.throws(
      () => createIntegrationRegistry([sample(id)]),
      /Invalid integration id/,
      JSON.stringify(id),
    );
  }
  assert.doesNotThrow(() =>
    createIntegrationRegistry([sample("a".repeat(40))]),
  );
});

test("registry rejects duplicate ids", () => {
  assert.throws(
    () => createIntegrationRegistry([sample("sample"), sample("sample")]),
    /Duplicate integration id/,
  );
});

test("registry returns undefined for unknown and prototype-like ids", () => {
  const registry = createIntegrationRegistry([sample("sample")]);
  for (const id of [
    "unknown",
    "SAMPLE",
    "__proto__",
    "constructor",
    "toString",
  ]) {
    assert.equal(registry.find(id), undefined, id);
  }
});
