import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Every 30 minutes: leftovers wait at most ~30 min, and the Neon Free plan
// (100 CU-hours/month, 5-minute scale-to-zero) stays awake only ~1/6 of the time.
test("Vercel Cron sweeps LINE leftovers every 30 minutes", () => {
  const config = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(config.crons, [
    { path: "/api/line/drain", schedule: "*/30 * * * *" },
  ]);
  // The cron path must be a real GET route (Vercel Cron sends GET).
  const route = readFileSync(
    new URL("../src/app/api/line/drain/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /export async function GET/);
});
