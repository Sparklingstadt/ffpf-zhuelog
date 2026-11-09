import assert from "node:assert/strict";
import { test } from "node:test";

import {
  entrySearchQuery,
  isEntrySearchEmpty,
  parseEntrySearch,
} from "../src/domain/learning/entry-search";

test("parseEntrySearch trims, takes the first value and ignores unknown kinds", () => {
  assert.deepEqual(parseEntrySearch({}), { query: "", kind: null, hint: "" });
  assert.deepEqual(
    parseEntrySearch({
      q: ["  学校 ", "x"],
      kind: "translation",
      hint: " 了 ",
    }),
    { query: "学校", kind: "translation", hint: "了" },
  );
  assert.equal(parseEntrySearch({ kind: "other" }).kind, null);
  assert.equal(parseEntrySearch({ kind: ["correction"] }).kind, "correction");
  assert.equal(parseEntrySearch({ q: 3 }).query, "");
});

test("long searches are cut to 100 characters, counting by code point", () => {
  const long = "𠮷".repeat(150);
  assert.equal([...parseEntrySearch({ q: long }).query].length, 100);
  assert.equal(
    [...parseEntrySearch({ hint: "a".repeat(101) }).hint].length,
    100,
  );
});

test("an empty search adds nothing to the query string", () => {
  const empty = parseEntrySearch({ q: "  ", kind: "", hint: "" });
  assert.ok(isEntrySearchEmpty(empty));
  assert.equal(entrySearchQuery(empty), "");
  const full = parseEntrySearch({ q: "a b", kind: "correction", hint: "了" });
  assert.ok(!isEntrySearchEmpty(full));
  assert.equal(entrySearchQuery(full), "q=a+b&kind=correction&hint=%E4%BA%86");
});
