import type {
  LineJobRepository,
  LineMessenger,
} from "../ports/line-job-repository";
import { makeLineLearningResult } from "@/domain/line/line-learning";
import { formatBatteryReply } from "@/domain/line/battery-report";
import { formatIssueReply } from "@/domain/line/development-mode";
import {
  formatGenerationFailure,
  type GenerationFailureCode,
} from "@/domain/line/generation-failure";

export class ProcessLineLearning {
  constructor(
    private readonly jobs: LineJobRepository,
    private readonly messenger: LineMessenger,
  ) {}

  async complete(
    id: string,
    token: string,
    userId: string,
    correction: unknown,
  ) {
    const job = await this.jobs.leased(id, token, userId, "GENERATING");
    if (!job || job.kind !== "correction") return false;
    const { draft, csv } = makeLineLearningResult(job.originalText, correction);
    return this.jobs.saveResult(job, draft, csv);
  }

  async completeBattery(
    id: string,
    token: string,
    userId: string,
    report: unknown,
  ) {
    const job = await this.jobs.leased(id, token, userId, "GENERATING");
    if (!job || job.kind !== "battery") return false;
    return this.jobs.saveReply(job, formatBatteryReply(report));
  }

  async deliver(id: string, token: string, userId: string) {
    const job = await this.jobs.leased(id, token, userId, "SENDING");
    if (!job) return false;
    const textReply =
      ["battery", "dev-issue", "dev-reply"].includes(job.kind) ||
      (job.kind === "correction" && Boolean(job.replyText));
    // LINE guarantees retry-key deduplication for 24h. Never send beyond that
    // window after an ambiguous response, even if this Mac was asleep.
    if (
      !(textReply
        ? job.replyText
        : job.kind === "correction"
          ? job.csv
          : null) ||
      !job.firstDeliveryAt ||
      Date.now() - job.firstDeliveryAt.getTime() >= 23 * 60 * 60 * 1000
    ) {
      await this.jobs.fail(job, true, "DELIVERY_WINDOW_EXPIRED");
      return true;
    }
    const outcome = textReply
      ? await this.messenger.pushText(job.userId, job.replyText!, job.retryKey)
      : await this.messenger.push(job.userId, job.csv!, job.retryKey);
    if (outcome === "accepted") await this.jobs.finishDelivery(job);
    else
      await this.jobs.fail(job, outcome === "rejected", "LINE_DELIVERY_FAILED");
    return true;
  }

  async beginIssue(id: string, token: string, userId: string) {
    const job = await this.jobs.leased(id, token, userId, "GENERATING");
    if (!job || job.kind !== "dev-issue") return null;
    return { allowed: await this.jobs.beginIssue(job) };
  }

  async completeIssue(
    id: string,
    token: string,
    userId: string,
    result: unknown,
  ) {
    const job = await this.jobs.leased(id, token, userId, "GENERATING");
    if (!job || job.kind !== "dev-issue") return false;
    return this.jobs.saveReply(job, formatIssueReply(result));
  }

  async generationFailed(
    id: string,
    token: string,
    userId: string,
    code: GenerationFailureCode = "CODEX_REQUEST_FAILED",
  ) {
    const job = await this.jobs.leased(id, token, userId, "GENERATING");
    if (!job) return false;
    if (job.kind === "correction") {
      const saved = await this.jobs.saveReply(
        job,
        formatGenerationFailure(code),
        code,
      );
      if (saved)
        console.warn(
          JSON.stringify({
            event: "line_correction_failed",
            at: new Date().toISOString(),
            jobId: job.id,
            code,
          }),
        );
      return saved;
    }
    await this.jobs.fail(job, false, "GENERATION_FAILED");
    return true;
  }
}
