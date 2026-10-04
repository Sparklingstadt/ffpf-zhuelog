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
      (j) => j.userId === userId && allowed.includes(j.status),
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
  async saveResult(job: LineJob, _draft: unknown, csv: string) {
    Object.assign(this.find(job), { status: "READY", leaseToken: null, csv });
    this.saved.push(job.id);
    return true;
  }
  async saveReply(job: LineJob, text: string) {
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
  async fail(job: LineJob, _permanent: boolean, code: string) {
    Object.assign(this.find(job), { status: "FAILED", leaseToken: null });
    this.failed.push(`${job.id}:${code}`);
  }
}

function setup(generator: Partial<LineLearningGenerator> = {}) {
  const clock = { now: 1_000_000 };
  const jobs = new FakeJobs();
  const calls: string[] = [];
  const pushes: { text: string; kind?: string }[] = [];
  const messenger: LineMessenger = {
    async pushText(_user, text) {
      pushes.push({ text });
      return "accepted";
    },
    async push(_user, csv, kind) {
      pushes.push({ text: csv, kind });
      return "accepted";
    },
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
    new ProcessLineLearning(jobs, messenger),
    fullGenerator,
    USER,
    () => clock.now,
  );
  return { clock, jobs, calls, pushes, drain };
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
