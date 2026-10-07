import type { LineJob } from "../../../domain/line/line-learning";
import type { LineJobRepository } from "../../../domain/line/repositories/line-job-repository";
import { LineGenerationError } from "../../../domain/line/generation-failure";
import type { LineLearningGenerator } from "../ports/line-learning-generator";
import type { ProcessLineLearning } from "./process-line-learning";

// One generation may take up to 20s; below this much remaining time only
// deliveries are claimed, so no generation is started that cannot finish.
export const GENERATION_RESERVE_MS = 21_000;

export class DrainLineJobs {
  constructor(
    private readonly jobs: LineJobRepository,
    private readonly process: ProcessLineLearning,
    private readonly generator: LineLearningGenerator,
    private readonly userId: string,
    private readonly now: () => number = Date.now,
    // Told which job failed, never why: errors may carry row data. The core
    // has no logger, so the composition root decides how to record it.
    private readonly onJobError: (jobId: string) => void = () => {},
  ) {}

  // Processes jobs until none is left or the deadline (epoch ms) passes.
  // Returns how many jobs were claimed and handled, including ones whose
  // processing failed. A failure in one job never stops the others; only
  // claim errors propagate, for the caller to report.
  async execute(deadline: number) {
    let processed = 0;
    while (this.now() < deadline) {
      const phase =
        deadline - this.now() < GENERATION_RESERVE_MS ? "deliver" : "any";
      const job = await this.jobs.claim(this.userId, phase);
      if (!job?.leaseToken) break;
      const token = job.leaseToken;
      try {
        if (job.status === "GENERATING")
          await this.generate(job, token, deadline);
        else await this.process.deliver(job.id, token, this.userId);
      } catch {
        // The lease expires and the repository retries or fails the job.
        this.onJobError(job.id);
      }
      processed++;
    }
    return processed;
  }

  private async generate(job: LineJob, token: string, deadline: number) {
    // Without a note owner the result could not be saved, so skip OpenAI.
    if (await this.process.rejectIfNoteOwnerMissing(job.id, token, this.userId))
      return;
    let output: unknown;
    try {
      const signal = AbortSignal.timeout(Math.max(1, deadline - this.now()));
      output =
        job.kind === "translation"
          ? await this.generator.translate(job.originalText, signal)
          : await this.generator.correct(job.originalText, signal);
    } catch (error) {
      await this.process.generationFailed(
        job.id,
        token,
        this.userId,
        error instanceof LineGenerationError
          ? error.code
          : "OPENAI_REQUEST_FAILED",
      );
      return;
    }
    try {
      await this.process.complete(job.id, token, this.userId, output);
    } catch {
      this.onJobError(job.id);
      // Reply with a failure instead of regenerating: one OpenAI call per message.
      await this.process.generationFailed(
        job.id,
        token,
        this.userId,
        "OPENAI_INVALID_RESPONSE",
      );
    }
  }
}
