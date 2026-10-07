import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DrainLineJobs,
  GENERATION_RESERVE_MS,
} from "@ffpf-zhuelog/core/application/line/use-cases/drain-line-jobs";
import { ProcessLineLearning } from "@ffpf-zhuelog/core/application/line/use-cases/process-line-learning";
import type { LineLearningGenerator } from "@ffpf-zhuelog/core/application/line/ports/line-learning-generator";
import type { LineMessenger } from "@ffpf-zhuelog/core/application/line/ports/line-messenger";
import { LineGenerationError } from "@ffpf-zhuelog/core/domain/line/generation-failure";
import type {
  LineJob,
  LineJobKind,
  LineJobStatus,
} from "@ffpf-zhuelog/core/domain/line/line-learning";
import type { LineJobRepository } from "@ffpf-zhuelog/core/domain/line/repositories/line-job-repository";

const USER = "U1";
const output = {
  correctedText: "我很忙。",
  pinyin: "Wǒ hěn máng.",
  hints: ["忙"],
};
const translation = {
  translatedText: "今天很忙。",
  pinyin: "Jīntiān hěn máng.",
  hints: ["忙しい=忙"],
};

class FakeJobs implements LineJobRepository {
  jobs: LineJob[] = [];
  claimPhases: string[] = [];
  saved: string[] = [];
  failed: string[] = [];
  failCodes: string[] = [];
  throwOnSave = new Set<string>();
  // Jobs scheduled for a later retry; the real repository sets availableAt.
  backedOff = new Set<string>();

  add(kind: LineJobKind, status: LineJobStatus, id: string) {
    this.jobs.push({
      kind,
      status,
      id,
      eventId: `e-${id}`,
      userId: USER,
      originalText: `text-${id}`,
      receivedAt: new Date(),
      leaseToken: null,
      csv: status === "READY" ? '"csv"' : null,
      replyText: null,
      retryKey: `retry-${id}`,
      firstDeliveryAt: null,
      generationTries: 0,
      deliveryTries: 0,
    });
  }
  async enqueue() {}
  async claim(userId: string, phase: "any" | "deliver" = "any") {
    this.claimPhases.push(phase);
    const allowed: LineJobStatus[] =
      phase === "deliver"
        ? ["READY", "SENDING"]
        : ["PENDING", "GENERATING", "READY", "SENDING"];
    const job = this.jobs.find(
      (j) =>
        j.userId === userId &&
        allowed.includes(j.status) &&
        !j.leaseToken &&
        !this.backedOff.has(j.id),
    );
    if (!job) return null;
    job.leaseToken = `lease-${job.id}-${job.generationTries + job.deliveryTries}`;
    if (job.status === "PENDING" || job.status === "GENERATING") {
      job.status = "GENERATING";
      job.generationTries++;
    } else {
      job.status = "SENDING";
      job.deliveryTries++;
      job.firstDeliveryAt ??= new Date();
    }
    return { ...job };
  }
  async leased(
    id: string,
    token: string,
    userId: string,
    status: LineJobStatus,
  ) {
    const job = this.jobs.find(
      (j) =>
        j.id === id &&
        j.leaseToken === token &&
        j.userId === userId &&
        j.status === status,
    );
    return job ? { ...job } : null;
  }
  private find(job: LineJob) {
    return this.jobs.find((j) => j.id === job.id)!;
  }
  owners: string[] = [];
  async saveResult(
    job: LineJob,
    ownerId: string,
    _draft: unknown,
    csv: string,
  ) {
    if (this.throwOnSave.has(job.id)) throw new Error("db down");
    this.owners.push(ownerId);
    Object.assign(this.find(job), { status: "READY", leaseToken: null, csv });
    this.saved.push(job.id);
    return true;
  }
  async saveReply(job: LineJob, text: string, code?: string) {
    if (code) this.failCodes.push(`${job.id}:${code}`);
    Object.assign(this.find(job), {
      status: "READY",
      leaseToken: null,
      replyText: text,
    });
    return true;
  }
  async finishDelivery(job: LineJob) {
    Object.assign(this.find(job), { status: "SENT", leaseToken: null });
  }
  async fail(job: LineJob, permanent: boolean, code: string) {
    const exhausted = job.deliveryTries >= 5;
    Object.assign(this.find(job), {
      status: permanent || exhausted ? "FAILED" : "READY",
      leaseToken: null,
    });
    if (!permanent && !exhausted) this.backedOff.add(job.id);
    this.failed.push(`${job.id}:${code}`);
  }
}

function setup(
  generator: Partial<LineLearningGenerator> = {},
  push?: LineMessenger["push"],
  noteOwnerId: string | null = "o1",
) {
  const errors: string[] = [];
  const ownerMissing: string[] = [];
  const clock = { now: 1_000_000 };
  const jobs = new FakeJobs();
  const calls: string[] = [];
  const pushes: { text: string; kind?: string }[] = [];
  const messenger: LineMessenger = {
    async pushText(_user, text) {
      pushes.push({ text });
      return "accepted";
    },
    push:
      push ??
      (async (_user, csv, kind) => {
        pushes.push({ text: csv, kind });
        return "accepted";
      }),
  };
  const fullGenerator: LineLearningGenerator = {
    async correct(text) {
      calls.push(`correct:${text}`);
      return output;
    },
    async translate(text) {
      calls.push(`translate:${text}`);
      return translation;
    },
    ...generator,
  };
  const drain = new DrainLineJobs(
    jobs,
    new ProcessLineLearning(jobs, messenger, noteOwnerId, () =>
      ownerMissing.push("LINE_NOTE_OWNER_MISSING"),
    ),
    fullGenerator,
    USER,
    () => clock.now,
    (jobId) => errors.push(jobId),
  );
  return { clock, jobs, calls, pushes, drain, errors, ownerMissing };
}

test("jobs are generated and delivered oldest first", async () => {
  const { clock, jobs, calls, pushes, drain } = setup();
  jobs.add("correction", "PENDING", "a");
  jobs.add("translation", "PENDING", "b");
  const processed = await drain.execute(clock.now + 120_000);
  assert.deepEqual(calls, ["correct:text-a", "translate:text-b"]);
  assert.deepEqual(
    pushes.map((p) => p.kind),
    ["correction", "translation"],
  );
  assert.equal(processed, 4);
  assert.deepEqual(
    jobs.jobs.map((j) => j.status),
    ["SENT", "SENT"],
  );
});

test("generation failures become failure replies", async () => {
  const { clock, jobs, pushes, drain } = setup({
    async translate() {
      throw new LineGenerationError("OPENAI_RATE_LIMITED");
    },
  });
  jobs.add("translation", "PENDING", "a");
  await drain.execute(clock.now + 120_000);
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0].text.startsWith("翻訳できませんでした。"));
  assert.ok(pushes[0].text.includes("OPENAI_RATE_LIMITED"));
  assert.deepEqual(jobs.saved, []);
});

test("notes are saved under the note owner", async () => {
  const { clock, jobs, drain } = setup();
  jobs.add("correction", "PENDING", "a");
  await drain.execute(clock.now + 120_000);
  assert.deepEqual(jobs.owners, ["o1"]);
});

test("without a note owner each job gets a failure reply and the rest keep processing", async () => {
  const { clock, jobs, calls, pushes, drain, errors, ownerMissing } = setup(
    {},
    undefined,
    null,
  );
  jobs.add("correction", "PENDING", "a");
  jobs.add("translation", "PENDING", "b");
  await drain.execute(clock.now + 120_000);
  assert.deepEqual(calls, ["correct:text-a", "translate:text-b"]);
  assert.deepEqual(jobs.saved, []);
  assert.deepEqual(jobs.failed, []);
  assert.deepEqual(jobs.failCodes, [
    "a:NOTE_OWNER_MISSING",
    "b:NOTE_OWNER_MISSING",
  ]);
  assert.equal(pushes.length, 2);
  assert.ok(pushes[0].text.startsWith("添削できませんでした。"));
  assert.ok(pushes[1].text.startsWith("翻訳できませんでした。"));
  assert.ok(pushes.every((p) => p.text.includes("NOTE_OWNER_MISSING")));
  assert.deepEqual(ownerMissing, [
    "LINE_NOTE_OWNER_MISSING",
    "LINE_NOTE_OWNER_MISSING",
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    jobs.jobs.map((j) => j.status),
    ["SENT", "SENT"],
  );
});

test("unexpected errors are reported generically", async () => {
  const { clock, jobs, pushes, drain } = setup({
    async correct() {
      throw new Error("boom");
    },
  });
  jobs.add("correction", "PENDING", "a");
  await drain.execute(clock.now + 120_000);
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0].text.startsWith("添削できませんでした。"));
  assert.ok(pushes[0].text.includes("OPENAI_REQUEST_FAILED"));
  assert.ok(!pushes[0].text.includes("boom"));
  assert.deepEqual(jobs.saved, []);
});

test("with little time left only deliveries are claimed", async () => {
  const { clock, jobs, calls, pushes, drain } = setup();
  jobs.add("correction", "PENDING", "generate");
  jobs.add("translation", "READY", "deliver");
  assert.ok(20_000 < GENERATION_RESERVE_MS);
  const processed = await drain.execute(clock.now + 20_000);
  assert.deepEqual(jobs.claimPhases, ["deliver", "deliver"]);
  assert.equal(processed, 1);
  assert.equal(pushes.length, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(jobs.failed, []);
  const pending = jobs.jobs.find((j) => j.id === "generate")!;
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.generationTries, 0);
});

test("the loop stops at the deadline", async () => {
  const { clock, jobs, drain } = setup();
  jobs.add("correction", "PENDING", "a");
  const processed = await drain.execute(clock.now);
  assert.equal(processed, 0);
  assert.deepEqual(jobs.claimPhases, []);
});

test("a temporary delivery failure stays queued", async () => {
  let attempts = 0;
  const { clock, jobs, drain } = setup({}, async () => {
    attempts++;
    return "retry";
  });
  jobs.add("correction", "READY", "a");
  const processed = await drain.execute(clock.now + 120_000);
  const job = jobs.jobs[0];
  assert.equal(processed, 1);
  assert.equal(attempts, 1);
  assert.equal(job.status, "READY");
  assert.equal(job.deliveryTries, 1);
  assert.deepEqual(jobs.failed, ["a:LINE_DELIVERY_FAILED"]);
  assert.deepEqual(jobs.claimPhases, ["any", "any"]);
});

test("a save failure after generation replies with a failure and moves on", async () => {
  const { clock, jobs, calls, pushes, drain, errors } = setup();
  jobs.add("correction", "PENDING", "a");
  jobs.add("correction", "PENDING", "b");
  jobs.throwOnSave.add("a");
  await drain.execute(clock.now + 120_000);
  assert.deepEqual(errors, ["a"]);
  assert.deepEqual(calls, ["correct:text-a", "correct:text-b"]);
  assert.deepEqual(jobs.failCodes, ["a:OPENAI_INVALID_RESPONSE"]);
  assert.equal(pushes.length, 2);
  assert.ok(pushes[0].text.includes("OPENAI_INVALID_RESPONSE"));
  assert.deepEqual(
    jobs.jobs.map((j) => j.status),
    ["SENT", "SENT"],
  );
});

test("a delivery error does not stop the drain", async () => {
  const delivered: string[] = [];
  let first = true;
  const { clock, jobs, drain, errors } = setup(
    {},
    async (_user, _csv, _kind, key) => {
      if (first) {
        first = false;
        throw new Error("network");
      }
      delivered.push(key);
      return "accepted";
    },
  );
  jobs.add("correction", "READY", "a");
  jobs.add("correction", "READY", "b");
  const processed = await drain.execute(clock.now + 120_000);
  assert.deepEqual(delivered, ["retry-b"]);
  assert.equal(processed, 2);
  assert.deepEqual(errors, ["a"]);
});

test("claim errors propagate", async () => {
  const { clock, jobs, drain } = setup();
  jobs.claim = async () => {
    throw new Error("db down");
  };
  await assert.rejects(drain.execute(clock.now + 120_000), /db down/);
});
