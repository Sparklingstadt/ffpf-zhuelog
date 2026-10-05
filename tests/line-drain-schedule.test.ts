import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Every 30 minutes: leftovers wait at most ~30 min, and the Neon Free plan
// (100 CU-hours/month, 5-minute scale-to-zero) stays awake only ~1/6 of the time.
test("Cloud Scheduler sweeps LINE leftovers every 30 minutes", () => {
  const script = readFileSync(
    new URL("../scripts/enable-line-cloud-run.sh", import.meta.url),
    "utf8",
  );
  assert.match(script, /--schedule '\*\/30 \* \* \* \*'/);
  assert.match(script, /--http-method GET --uri "\$URL\/api\/line\/drain"/);
  // Request-based billing: the webhook hands the drain to Cloud Tasks instead
  // of keeping the CPU allocated for after().
  assert.match(script, /--cpu-throttling/);
  assert.doesNotMatch(script, /--no-cpu-throttling/);
  assert.match(script, /LINE_DRAIN_TASKS_QUEUE=\$queue_name/);
  // The schedule must be a real GET route.
  const route = readFileSync(
    new URL("../src/app/api/line/drain/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /export async function GET/);
  // LINE runs on Cloud Run; a Vercel Cron would call a disabled drain.
  assert.equal(existsSync(new URL("../vercel.json", import.meta.url)), false);
});
