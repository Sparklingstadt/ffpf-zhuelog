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
  ) {}

  // Processes jobs until none is left or the deadline (epoch ms) passes.
  // Returns how many were generated or delivered.
  async execute(deadline: number) {
    let processed = 0;
    while (this.now() < deadline) {
      const phase =
        deadline - this.now() < GENERATION_RESERVE_MS ? "deliver" : "any";
      const job = await this.jobs.claim(this.userId, phase);
      if (!job?.leaseToken) break;
      if (job.status === "GENERATING") await this.generate(job, deadline);
      else await this.process.deliver(job.id, job.leaseToken, this.userId);
      processed++;
    }
    return processed;
  }

  private async generate(
    job: NonNullable<Awaited<ReturnType<LineJobRepository["claim"]>>>,
    deadline: number,
  ) {
    const token = job.leaseToken!;
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
    await this.process.complete(job.id, token, this.userId, output);
  }
}
