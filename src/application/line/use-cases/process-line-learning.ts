import type {
  LineJobRepository,
  LineMessenger,
} from "../ports/line-job-repository";
import { makeLineLearningResult } from "@/domain/line/line-learning";

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
    if (!job) return false;
    const { draft, csv } = makeLineLearningResult(job.originalText, correction);
    return this.jobs.saveResult(job, draft, csv);
  }

  async deliver(id: string, token: string, userId: string) {
    const job = await this.jobs.leased(id, token, userId, "SENDING");
    if (!job) return false;
    // LINE guarantees retry-key deduplication for 24h. Never send beyond that
    // window after an ambiguous response, even if this Mac was asleep.
    if (
      !job.csv ||
      !job.firstDeliveryAt ||
      Date.now() - job.firstDeliveryAt.getTime() >= 23 * 60 * 60 * 1000
    ) {
      await this.jobs.fail(job, true, "DELIVERY_WINDOW_EXPIRED");
      return true;
    }
    const outcome = await this.messenger.push(
      job.userId,
      job.csv,
      job.retryKey,
    );
    if (outcome === "accepted") await this.jobs.finishDelivery(job);
    else
      await this.jobs.fail(job, outcome === "rejected", "LINE_DELIVERY_FAILED");
    return true;
  }

  async generationFailed(id: string, token: string, userId: string) {
    const job = await this.jobs.leased(id, token, userId, "GENERATING");
    if (!job) return false;
    await this.jobs.fail(job, false, "GENERATION_FAILED");
    return true;
  }
}
