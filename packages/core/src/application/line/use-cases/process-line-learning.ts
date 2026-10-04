import type { LineJobRepository } from "../../../domain/line/repositories/line-job-repository";
import type { LineMessenger } from "../ports/line-messenger";
import {
  makeLineLearningResult,
  type LineJobKind,
} from "../../../domain/line/line-learning";
import type { LearningKind } from "../../../domain/learning/entities/learning-entry";
import {
  formatGenerationFailure,
  type GenerationFailureCode,
} from "../../../domain/line/generation-failure";

// Jobs whose reply is always plain text.
const TEXT_REPLY_KINDS: readonly LineJobKind[] = ["text-too-long"];

// Jobs that produce a learning note; they send their CSV unless they failed.
function noteKind(kind: LineJobKind): LearningKind | null {
  return kind === "correction" || kind === "translation" ? kind : null;
}

export class ProcessLineLearning {
  constructor(
    private readonly jobs: LineJobRepository,
    private readonly messenger: LineMessenger,
  ) {}

  async complete(id: string, token: string, userId: string, output: unknown) {
    const job = await this.jobs.leased(id, token, userId, "GENERATING");
    const kind = job && noteKind(job.kind);
    if (!job || !kind) return false;
    let result: ReturnType<typeof makeLineLearningResult>;
    try {
      result = makeLineLearningResult(kind, job.originalText, output);
    } catch (error) {
      // Retrying cannot shorten the result, so reply instead of failing silently.
      if (!(error instanceof Error && error.message === "CSV_TOO_LONG"))
        throw error;
      return this.jobs.saveReply(
        job,
        formatGenerationFailure("CORRECTION_TOO_LONG", kind),
        "CORRECTION_TOO_LONG",
      );
    }
    return this.jobs.saveResult(job, result.draft, result.csv);
  }

  async deliver(id: string, token: string, userId: string) {
    const job = await this.jobs.leased(id, token, userId, "SENDING");
    if (!job) return false;
    const kind = noteKind(job.kind);
    const textReply =
      TEXT_REPLY_KINDS.includes(job.kind) || (kind && Boolean(job.replyText));
    const content = textReply ? job.replyText : kind ? job.csv : null;
    // A SENDING job always has content and a first attempt; anything else is
    // a broken record, which retrying cannot repair.
    if (!content || !job.firstDeliveryAt) {
      await this.jobs.fail(job, true, "DELIVERY_STATE_INVALID");
      return true;
    }
    // LINE guarantees retry-key deduplication for 24h. Never send beyond that
    // window after an ambiguous response, even if this Mac was asleep.
    if (Date.now() - job.firstDeliveryAt.getTime() >= 23 * 60 * 60 * 1000) {
      await this.jobs.fail(job, true, "DELIVERY_WINDOW_EXPIRED");
      return true;
    }
    const outcome =
      textReply || !kind
        ? await this.messenger.pushText(job.userId, content, job.retryKey)
        : await this.messenger.push(job.userId, content, kind, job.retryKey);
    if (outcome === "accepted") await this.jobs.finishDelivery(job);
    else
      await this.jobs.fail(job, outcome === "rejected", "LINE_DELIVERY_FAILED");
    return true;
  }

  async generationFailed(
    id: string,
    token: string,
    userId: string,
    code: GenerationFailureCode = "OPENAI_REQUEST_FAILED",
  ) {
    const job = await this.jobs.leased(id, token, userId, "GENERATING");
    if (!job) return false;
    const kind = noteKind(job.kind);
    if (kind)
      return this.jobs.saveReply(
        job,
        formatGenerationFailure(code, kind),
        code,
      );
    await this.jobs.fail(job, false, "GENERATION_FAILED");
    return true;
  }
}
