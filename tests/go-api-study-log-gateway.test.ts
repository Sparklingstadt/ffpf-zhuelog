import assert from "node:assert/strict";
import { test } from "node:test";

import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import { createStudyLogGateway } from "../src/infrastructure/go-api/study-log-gateway";

test("list asks for the range and returns the days", async () => {
  const calls: string[] = [];
  const day = {
    date: "2026-11-02",
    reviews: 5,
    practiceQuestions: 25,
    notes: 1,
    words: 2,
  };
  const call = (async (path: string, init: { method: string }) => {
    calls.push(`${init.method} ${path}`);
    return { days: [day] };
  }) as GoApiCall;
  const days = await createStudyLogGateway(call).list(
    "2026-10-26",
    "2026-12-06",
  );
  assert.deepEqual(calls, ["GET /v1/study-log?from=2026-10-26&to=2026-12-06"]);
  assert.deepEqual(days, [day]);
});
