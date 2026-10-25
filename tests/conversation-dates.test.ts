import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationSummary } from "../src/domain/chat/conversation";
import {
  conversationsOn,
  listConversationDates,
} from "../src/presentation/presenters/conversation-dates";

const summary = (id: string, createdAt: string): ConversationSummary => ({
  id,
  title: id,
  modelName: "gpt-test",
  ended: false,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
});

// Newest first, as Go returns them.
const items = [
  summary("c", "2026-10-24T02:00:00.000Z"),
  summary("b", "2026-10-23T15:30:00.000Z"), // 10/24 00:30 in Tokyo
  summary("a", "2026-10-23T14:59:00.000Z"), // 10/23 23:59 in Tokyo
];

test("listConversationDates groups by Tokyo date, newest first", () => {
  assert.deepEqual(listConversationDates(items), [
    { date: { year: 2026, month: 10, day: 24 }, count: 2 },
    { date: { year: 2026, month: 10, day: 23 }, count: 1 },
  ]);
  assert.deepEqual(listConversationDates([]), []);
});

test("conversationsOn numbers the day's conversations oldest first", () => {
  const day = conversationsOn(items, { year: 2026, month: 10, day: 24 });
  assert.deepEqual(
    day.map(({ id, number }) => [id, number]),
    [
      ["b", 1],
      ["c", 2],
    ],
  );
  assert.deepEqual(
    conversationsOn(items, { year: 2026, month: 10, day: 1 }),
    [],
  );
});
