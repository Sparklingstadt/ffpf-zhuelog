import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LINE_JOB_KINDS,
  LINE_JOB_STATUSES,
  type LineJob,
} from "@ffpf-zhuelog/core/domain/line/line-learning";
import { routeDevelopmentMessage } from "@ffpf-zhuelog/core/domain/line/development-routing";
import { toLineJob } from "../src/infrastructure/persistence/prisma/mappers/line-job-mapper";

// The newest migration that (re)defines a CHECK constraint is the DB's truth.
function checkedValues(constraint: string) {
  const dir = new URL("../prisma/migrations/", import.meta.url);
  const definition = new RegExp(
    `"${constraint}"\\s+CHECK\\s*\\(\\s*"\\w+"\\s+IN\\s*\\(([^)]*)\\)`,
    "g",
  );
  const list = readdirSync(dir)
    .filter((name) => !name.endsWith(".toml"))
    .sort()
    .flatMap((name) => [
      ...readFileSync(new URL(`${name}/migration.sql`, dir), "utf8").matchAll(
        definition,
      ),
    ])
    .at(-1)![1];
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
}

test("job kinds and statuses match the database CHECK constraints", () => {
  assert.deepEqual(
    [...LINE_JOB_KINDS].sort(),
    checkedValues("LineLearningJob_kind_check"),
  );
  assert.deepEqual(
    [...LINE_JOB_STATUSES].sort(),
    checkedValues("LineLearningJob_status_check"),
  );
});

test("development routing only produces storable kinds and statuses", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  const off = { expiresAt: null, lastEventAt: new Date(0) };
  const on = {
    expiresAt: new Date(now.getTime() + 60_000),
    lastEventAt: new Date(0),
  };
  for (const session of [off, on])
    for (const text of ["/dev", "/devend", "English", "中文", "/battery"])
      for (const receivedAt of [now, new Date(-1)]) {
        const { job } = routeDevelopmentMessage(
          { originalText: text, receivedAt },
          session,
          now,
        );
        assert.ok(LINE_JOB_KINDS.includes(job.kind), job.kind);
        assert.ok(LINE_JOB_STATUSES.includes(job.status), job.status);
      }
});

test("job kind and status are checked by the type system", () => {
  const kind: LineJob["kind"] = "dev-reply";
  const status: LineJob["status"] = "IGNORED";
  // @ts-expect-error a misspelled kind must not compile
  const badKind: LineJob["kind"] = "dev-replay";
  // @ts-expect-error a misspelled status must not compile
  const badStatus: LineJob["status"] = "GENERATED";
  assert.ok(kind && status && badKind && badStatus);
});

test("stored rows are narrowed to known kinds and statuses", () => {
  const row = {
    id: "job",
    kind: "correction",
    eventId: "event",
    userId: "user",
    originalText: "今天很忙。",
    receivedAt: new Date(),
    status: "PENDING",
    leaseToken: null,
    csv: null,
    replyText: null,
    retryKey: "key",
    firstDeliveryAt: null,
    generationTries: 0,
    deliveryTries: 0,
  };
  assert.deepEqual(toLineJob(row), row);
  assert.equal(toLineJob(null), null);
  assert.throws(() => toLineJob({ ...row, kind: "unknown" }));
  assert.throws(() => toLineJob({ ...row, status: "unknown" }));
});
