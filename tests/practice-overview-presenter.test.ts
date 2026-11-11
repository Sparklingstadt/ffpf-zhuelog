import assert from "node:assert/strict";
import { test } from "node:test";

import type { ComplementRoundMode } from "../src/domain/practice/complement-record";
import {
  latestByKind,
  mergeRounds,
  practiceKindOf,
} from "../src/presentation/presenters/practice-overview-presenter";

const round = (id: string, at: string) => ({
  id,
  questionCount: 25,
  firstTryCount: 20,
  missCount: 6,
  elapsedMs: 120_000,
  startedAt: new Date(at),
  createdAt: new Date(at),
});
const complement = (id: string, at: string, mode: ComplementRoundMode) => ({
  ...round(id, at),
  mode,
});

test("measure words and 了・过・着 are their own practices", () => {
  assert.equal(practiceKindOf({ mode: "measure" }), "measure");
  assert.equal(practiceKindOf({ mode: "aspect" }), "aspect");
  assert.equal(practiceKindOf({ mode: "result" }), "complement");
});

test("both kinds of rounds merge newest first, each with its own link", () => {
  const rows = mergeRounds(
    [round("p1", "2026-11-10T00:00:00Z")],
    [
      complement("c1", "2026-11-11T00:00:00Z", "aspect"),
      complement("c2", "2026-11-09T00:00:00Z", "result"),
    ],
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.kind, r.href]),
    [
      ["c1", "aspect", "/practice/complements/records/c1"],
      ["p1", "preposition", "/practice/prepositions/records/p1"],
      ["c2", "complement", "/practice/complements/records/c2"],
    ],
  );
  assert.equal(rows[0].label, "了・过・着");
  assert.match(rows[2].label, /^補語・/);
  assert.equal(rows[1].accuracy, 80);
});

test("the latest round of each practice is the first one met", () => {
  const rows = mergeRounds(
    [round("p2", "2026-11-12T00:00:00Z"), round("p1", "2026-11-01T00:00:00Z")],
    [],
  );
  const latest = latestByKind(rows);
  assert.equal(latest.preposition?.id, "p2");
  assert.equal(latest.complement, undefined);
});
