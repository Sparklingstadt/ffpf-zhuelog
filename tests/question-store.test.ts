import assert from "node:assert/strict";
import { test } from "node:test";

import { checkQuestionNote } from "../src/domain/chat/question";
import { questionNoteRow } from "../src/infrastructure/prisma/question-store";

test("questionNoteRow keeps the trimmed note, the server's model and now", () => {
  const now = new Date("2026-11-16T09:00:00.000Z");
  const note = checkQuestionNote({
    id: "0b6c3f2e-1d4a-4c8e-9f00-123456789abc",
    question: "  了の使い方は？ \n",
    answer: "\t完了を表します。 ",
  });
  assert.ok(note);
  assert.deepEqual(questionNoteRow("10001", note, "gpt-6.1-sol", now), {
    id: "0b6c3f2e-1d4a-4c8e-9f00-123456789abc",
    userId: "10001",
    question: "了の使い方は？",
    answer: "完了を表します。",
    modelName: "gpt-6.1-sol",
    createdAt: now,
  });
});
