import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildDemoSeed,
  DemoFixtureError,
  type DemoSeed,
  demoFixtureTime,
} from "../src/domain/demo/demo-seed";

const fixture: unknown = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "..",
      "src",
      "domain",
      "demo",
      "demo-fixture.json",
    ),
    "utf8",
  ),
);

// Written by the app's former Go implementation before it was removed; it is
// now a fixed file: the seed for each reset time, without the random UUIDs.
const golden: { cases: { now: string; seed: unknown }[] } = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures", "demo-seed-golden.json"),
    "utf8",
  ),
);

const resetTime = new Date("2026-11-10T19:00:00.000Z");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function counter(): () => string {
  let n = 0;
  return () => `u${++n}`;
}

// The seed as JSON, the way the golden file writes it: dates as ISO strings,
// no ids and no practice counts.
//
// Whoever changes the seed: the golden file leaves out a round's mode when it
// is empty, so a complement round with mode "" has no mode there, while this
// keeps mode: "" and the comparison fails on the keys. Edit the golden file
// by hand, leaving such a mode out.
function asGolden(seed: DemoSeed): unknown {
  const plain = JSON.parse(JSON.stringify(seed)) as Record<string, unknown>;
  const omit = (row: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) delete row[key];
  };
  for (const word of plain.words as Record<string, unknown>[]) {
    omit(word, ["id"]);
  }
  for (const conversation of plain.conversations as Record<string, unknown>[]) {
    omit(conversation, ["id"]);
    for (const message of conversation.messages as Record<string, unknown>[]) {
      omit(message, ["id"]);
    }
  }
  for (const key of ["prepositionRecords", "complementRecords"]) {
    for (const round of plain[key] as Record<string, unknown>[]) {
      omit(round, ["id", "questionCount", "firstTryCount", "missCount"]);
    }
  }
  return plain;
}

// ts-fsrs rounds FSRS's stability and difficulty to 8 decimals, where the
// golden file's go-fsrs did not (as in tests/review-fsrs.test.ts), so they
// are compared to 1e-7; everything else must be equal.
function assertSameJson(actual: unknown, expected: unknown, where: string) {
  if (typeof actual === "number" && typeof expected === "number") {
    if (Number.isInteger(expected)) {
      assert.equal(actual, expected, where);
    } else {
      const error = Math.abs(actual - expected) / Math.abs(expected);
      assert.ok(error <= 1e-7, `${where}: ${actual} is not ${expected}`);
    }
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: not an array`);
    assert.equal(actual.length, expected.length, `${where}: length`);
    expected.forEach((e, i) => assertSameJson(actual[i], e, `${where}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    assert.ok(
      actual !== null && typeof actual === "object" && !Array.isArray(actual),
      `${where}: not an object`,
    );
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    assert.deepEqual(Object.keys(a).sort(), Object.keys(e).sort(), where);
    for (const key of Object.keys(e)) {
      assertSameJson(a[key], e[key], `${where}.${key}`);
    }
    return;
  }
  assert.equal(actual, expected, where);
}

test("the seed matches the golden file", () => {
  assert.equal(golden.cases.length, 2);
  for (const c of golden.cases) {
    const seed = buildDemoSeed(fixture, new Date(c.now), counter());
    assertSameJson(asGolden(seed), c.seed, c.now);
  }
});

test("ids are fresh v4 UUIDs drawn in a fixed order", () => {
  const seed = buildDemoSeed(fixture, resetTime, counter());
  assert.deepEqual(
    seed.words.map((w) => w.id),
    Array.from({ length: 10 }, (_, i) => `u${i + 1}`),
  );
  let n = 10;
  const next = () => `u${++n}`;
  for (const conversation of seed.conversations) {
    assert.equal(conversation.id, next());
    for (const message of conversation.messages) {
      assert.equal(message.id, next());
    }
  }
  for (const round of seed.prepositionRecords) assert.equal(round.id, next());
  for (const round of seed.complementRecords) assert.equal(round.id, next());
  assert.equal(seed.conversations[0].id, "u11");
  assert.equal(seed.complementRecords.at(-1)?.id, `u${n}`);

  const ids = (s: DemoSeed) => [
    ...s.words.map((w) => w.id),
    ...s.conversations.flatMap((c) => [c.id, ...c.messages.map((m) => m.id)]),
    ...s.prepositionRecords.map((r) => r.id),
    ...s.complementRecords.map((r) => r.id),
  ];
  const first = ids(buildDemoSeed(fixture, resetTime, randomUUID));
  const second = ids(buildDemoSeed(fixture, resetTime, randomUUID));
  for (const id of [...first, ...second]) assert.match(id, uuidPattern);
  assert.equal(new Set([...first, ...second]).size, first.length * 2);
});

test("a day later everything moves by a day", () => {
  const today = buildDemoSeed(fixture, resetTime, randomUUID);
  const tomorrow = buildDemoSeed(
    fixture,
    new Date(resetTime.getTime() + 86_400_000),
    randomUUID,
  );
  assert.equal(
    tomorrow.notes[0].createdAt.getTime() - today.notes[0].createdAt.getTime(),
    86_400_000,
  );
});

test("times follow Japan's calendar", () => {
  assert.equal(
    demoFixtureTime(
      new Date("2026-11-10T15:30:00Z"),
      1,
      "09:15",
    )?.toISOString(),
    "2026-11-10T00:15:00.000Z",
  );
  assert.equal(
    demoFixtureTime(resetTime, 0, "21:00")?.toISOString(),
    "2026-11-10T18:59:00.000Z",
  );
  assert.equal(demoFixtureTime(resetTime, -1, "09:15"), null);
  assert.equal(demoFixtureTime(resetTime, 1.5, "09:15"), null);
  assert.equal(demoFixtureTime(resetTime, 1, "9:15"), null);
  assert.equal(demoFixtureTime(resetTime, 1, "24:00"), null);
  assert.equal(demoFixtureTime(resetTime, 1, "x"), null);
});

// A fixture with one note, for the cases below.
function small(overrides: {
  note?: Record<string, unknown>;
  word?: Record<string, unknown>;
  rounds?: unknown[];
}): Record<string, unknown> {
  return {
    displayName: "x",
    notes: [
      {
        day: 2,
        time: "09:00",
        kind: "correction",
        original: "a",
        corrected: "b",
        pinyin: "c",
        hints: [],
        ...overrides.note,
      },
    ],
    words: overrides.word
      ? [{ word: "w", pinyin: "p", meaning: "m", note: 0, ...overrides.word }]
      : [],
    conversations: [],
    prepositionRecords: overrides.rounds ?? [],
    complementRecords: [],
  };
}

test("practice rounds are counted from their questions", () => {
  const seed = buildDemoSeed(fixture, resetTime, randomUUID);
  const round = seed.prepositionRecords[0];
  const misses = round.questions.map((q) => q.misses.length);
  assert.equal(round.questionCount, round.questions.length);
  assert.equal(round.firstTryCount, misses.filter((m) => m === 0).length);
  assert.equal(
    round.missCount,
    misses.reduce((a, b) => a + b, 0),
  );
  assert.ok(round.missCount > 0);

  const question = { id: "P1", answer: "在", noun: "n", prompt: "p" };
  const withNull = buildDemoSeed(
    small({
      rounds: [
        {
          day: 1,
          time: "20:00",
          elapsedSeconds: 30,
          questions: [
            { ...question, misses: null },
            { ...question },
            { ...question, misses: ["对"] },
          ],
        },
      ],
    }),
    resetTime,
    randomUUID,
  ).prepositionRecords[0];
  assert.deepEqual(
    withNull.questions.map((q) => q.misses),
    [[], [], ["对"]],
  );
  assert.equal(withNull.elapsedMs, 30_000);
  assert.equal(
    withNull.createdAt.getTime() - withNull.startedAt.getTime(),
    30_000,
  );
  assert.equal(withNull.questionCount, 3);
  assert.equal(withNull.firstTryCount, 2);
  assert.equal(withNull.missCount, 1);
});

test("a broken fixture names its first problem", () => {
  const answer = (day: number, time: string, rating: number) => ({
    day,
    time,
    rating,
  });
  const broken: [string, unknown][] = [
    [
      "unknown key",
      {
        displayName: "x",
        notes: [],
        words: [],
        conversations: [],
        prepositionRecords: [],
        complementRecords: [],
        extra: 1,
      },
    ],
    ["unknown note key", small({ note: { extra: 1 } })],
    ["notes not an array", { ...small({}), notes: {} }],
    ["day -1", small({ note: { day: -1 } })],
    ["time 25:00", small({ note: { time: "25:00" } })],
    [
      "rating 5",
      small({
        note: { review: { answers: [answer(1, "08:00", 5)], due: "today" } },
      }),
    ],
    [
      "answer before the note",
      small({
        note: { review: { answers: [answer(3, "08:00", 3)], due: "today" } },
      }),
    ],
    [
      "two answers at once",
      small({
        note: {
          review: {
            answers: [answer(1, "08:00", 3), answer(1, "08:00", 3)],
            due: "today",
          },
        },
      }),
    ],
    ["due soon", small({ note: { review: { answers: [], due: "soon" } } })],
    ["word of note 3", small({ word: { note: 3 } })],
  ];
  for (const [name, f] of broken) {
    assert.throws(
      () => buildDemoSeed(f, resetTime, randomUUID),
      (error: unknown) =>
        error instanceof DemoFixtureError && error.message.length > 0,
      name,
    );
  }
  // The small fixture itself is fine.
  assert.equal(
    buildDemoSeed(small({ word: { note: 0 } }), resetTime, randomUUID).words
      .length,
    1,
  );
});
