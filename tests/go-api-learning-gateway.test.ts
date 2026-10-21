import assert from "node:assert/strict";
import { test } from "node:test";

import { GoApiError } from "../src/infrastructure/go-api/client";
import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import { createLearningGateway } from "../src/infrastructure/go-api/learning-gateway";

const entryJson = {
  id: "e1",
  kind: "translation",
  originalText: "我去",
  correctedText: "我去了",
  pinyin: "wǒ qù le",
  hints: [],
  createdAt: "2026-10-22T03:04:05.000Z",
  sharedAt: null,
};

function fakeCall(response: unknown) {
  const paths: string[] = [];
  const call = (async (path: string) => {
    paths.push(path);
    if (response instanceof Error) throw response;
    return response;
  }) as GoApiCall;
  return { call, paths };
}

const self = { kind: "self", ownerId: "o1" } as const;
const other = { kind: "other", ownerId: "o 2" } as const;
const date = { year: 2026, month: 4, day: 7 };

test("listRecent reads one page of 100 with the total", async () => {
  const { call, paths } = fakeCall({
    entries: [entryJson],
    nextCursor: "c",
    total: 250,
  });
  const result = await createLearningGateway(call).listRecent(self, 100);
  assert.deepEqual(paths, ["/v1/entries?limit=100"]);
  assert.equal(result.total, 250);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, "e1");
  assert.deepEqual(
    result.entries[0].createdAt,
    new Date("2026-10-22T03:04:05.000Z"),
  );
});

test("only another member's notes add ?user=", async () => {
  const { call, paths } = fakeCall({ entries: [], total: 0 });
  const gateway = createLearningGateway(call);
  await gateway.listRecent(other, 100);
  await gateway.listDailyEntries(other, date);
  await gateway.listDailyEntries(self, date);
  assert.deepEqual(paths, [
    "/v1/entries?limit=100&user=o%202",
    "/v1/log-dates/2026-04-07/entries?user=o%202",
    "/v1/log-dates/2026-04-07/entries",
  ]);
});

test("listLogDates keeps Go's Japan dates and counts in order", async () => {
  const { call, paths } = fakeCall({
    dates: [
      { date: "2026-10-05", count: 1 },
      { date: "2026-10-04", count: 2 },
    ],
  });
  const dates = await createLearningGateway(call).listLogDates(other);
  assert.deepEqual(paths, ["/v1/log-dates?user=o%202"]);
  assert.deepEqual(dates, [
    { date: { year: 2026, month: 10, day: 5 }, count: 1 },
    { date: { year: 2026, month: 10, day: 4 }, count: 2 },
  ]);
});

test("listDailyEntries returns the day's entries", async () => {
  const { call } = fakeCall({
    date: "2026-04-07",
    entries: [{ ...entryJson, number: 1 }],
  });
  const entries = await createLearningGateway(call).listDailyEntries(
    self,
    date,
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["e1"],
  );
});

test("getDailyEntry returns the entry with the day's total", async () => {
  const { call, paths } = fakeCall({ entry: entryJson, number: 3, total: 5 });
  const result = await createLearningGateway(call).getDailyEntry(self, date, 3);
  assert.deepEqual(paths, ["/v1/log-dates/2026-04-07/entries/3"]);
  assert.equal(result?.entry.id, "e1");
  assert.equal(result?.total, 5);
});

test("getDailyEntry for another member's note adds ?user=", async () => {
  const { call, paths } = fakeCall({ entry: entryJson, number: 2, total: 2 });
  await createLearningGateway(call).getDailyEntry(other, date, 2);
  assert.deepEqual(paths, ["/v1/log-dates/2026-04-07/entries/2?user=o%202"]);
});

test("getDailyEntry turns a 404 into null", async () => {
  const { call } = fakeCall(new GoApiError(404, "not_found"));
  assert.equal(
    await createLearningGateway(call).getDailyEntry(self, date, 9),
    null,
  );
});

test("getDailyEntry lets other Go errors through", async () => {
  const { call } = fakeCall(new GoApiError(500, "internal"));
  await assert.rejects(
    createLearningGateway(call).getDailyEntry(self, date, 1),
    (error) => error instanceof GoApiError && error.status === 500,
  );
});
