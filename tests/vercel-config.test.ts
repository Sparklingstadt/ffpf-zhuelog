import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { sessionGate } from "../src/presentation/http/session-gate";

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  buildCommand?: string;
  crons?: { path: string; schedule: string }[];
};

test("the crons run the two routes at their daily times", () => {
  assert.deepEqual(config.crons, [
    { path: "/api/cron/line-drain", schedule: "0 21 * * *" },
    { path: "/api/cron/demo-reset", schedule: "0 19 * * *" },
  ]);
  assert.equal(config.buildCommand, "bash scripts/vercel-build.sh");
});

test("every cron path is a public GET route with a maximum duration", () => {
  assert.ok((config.crons ?? []).length > 0);
  for (const { path } of config.crons ?? []) {
    const file = `src/app${path}/route.ts`;
    assert.ok(existsSync(file), `${file} exists`);
    const source = readFileSync(file, "utf8");
    assert.match(source, /export async function GET\(/);
    assert.match(source, /export const maxDuration = \d+;/);
    assert.match(source, /export const dynamic = "force-dynamic";/);

    // No zl_session: the gate still passes the cron route through.
    const response = sessionGate(
      new NextRequest(`https://zhuelog.test${path}`, { method: "GET" }),
      () => {
        const next = NextResponse.next();
        next.headers.set("x-test-next", "1");
        return next;
      },
    );
    assert.equal(response.headers.get("x-test-next"), "1", path);
  }
});
