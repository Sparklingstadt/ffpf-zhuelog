import assert from "node:assert/strict";
import { test } from "node:test";

import {
  kindFromSlug,
  PRACTICE_KIND_LIST,
  PRACTICE_KINDS,
} from "../src/domain/practice/practice-kind";
import { PREPOSITION_ALSO_IN } from "../src/domain/practice/preposition-also-in";

test("kinds are found by their URL slug", () => {
  assert.equal(kindFromSlug("prepositions"), "preposition");
  assert.equal(kindFromSlug("complements"), "complement");
  assert.equal(kindFromSlug("complement"), null);
  assert.equal(kindFromSlug(""), null);
});

test("each kind's paths and labels follow its slug and word", () => {
  assert.deepEqual(
    PRACTICE_KIND_LIST.map((c) => c.kind),
    ["preposition", "complement"],
  );
  for (const c of PRACTICE_KIND_LIST) {
    assert.equal(c.path, `/practice/${c.slug}`);
    assert.equal(c.recordsPath, `${c.path}/records`);
    assert.ok(c.title.startsWith(c.wordLabel), c.kind);
    assert.ok(c.navLabel.startsWith(c.wordLabel), c.kind);
    assert.equal(c.questionCount, 25);
    assert.ok(c.source.usages.length >= 100, c.kind);
  }
  assert.equal(PRACTICE_KINDS.preposition.apiPath, "/v1/preposition-records");
  assert.equal(PRACTICE_KINDS.complement.apiPath, "/v1/complement-records");
  assert.equal(PRACTICE_KINDS.preposition.wordLabel, "介詞");
  assert.equal(PRACTICE_KINDS.complement.wordLabel, "補語");
  assert.deepEqual(
    PRACTICE_KINDS.preposition.source.alsoIn,
    PREPOSITION_ALSO_IN,
  );
  assert.equal(PRACTICE_KINDS.complement.source.alsoIn, undefined);
});
