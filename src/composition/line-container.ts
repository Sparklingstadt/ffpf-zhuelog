import { DrainLineJobs } from "@ffpf-zhuelog/core/application/line/use-cases/drain-line-jobs";
import { ProcessLineLearning } from "@ffpf-zhuelog/core/application/line/use-cases/process-line-learning";
import {
  CloudTasksDrainTrigger,
  getDrainTasksConfig,
} from "@/infrastructure/line/cloud-tasks-drain-trigger";
import { getLineConfig } from "@/infrastructure/line/config";
import {
  DrainForwarder,
  getDrainForwardConfig,
} from "@/infrastructure/line/drain-forwarder";
import { LinePushMessenger } from "@/infrastructure/line/line-messenger";
import { OpenAiLineLearningGenerator } from "@/infrastructure/line/openai-line-learning-generator";
import { PrismaLineJobRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-line-job-repository";

export function createLineContainer() {
  const config = getLineConfig();
  const jobs = new PrismaLineJobRepository();
  // Built on demand: an invalid endpoint override throws here, and that must
  // never break the webhook response or the drain route's authentication.
  const createDrain = () =>
    config
      ? new DrainLineJobs(
          jobs,
          new ProcessLineLearning(
            jobs,
            new LinePushMessenger(config.accessToken),
            config.noteOwnerId,
            // A fixed code only: the job has message text and row data.
            () => console.error("LINE_NOTE_OWNER_MISSING"),
          ),
          new OpenAiLineLearningGenerator(process.env.OPENAI_API_KEY ?? ""),
          config.userId,
          Date.now,
          // The job ID only: the error may carry message text or row data.
          (jobId) => console.error("LINE_JOB_FAILED", jobId),
        )
      : null;
  // Cloud Run only: Vercel and the E2E server keep draining in after().
  const createDrainTrigger = () => {
    const tasks = config ? getDrainTasksConfig() : null;
    return tasks ? new CloudTasksDrainTrigger(tasks) : null;
  };
  // Vercel only: with LINE disabled here, Vercel Cron's drain goes to Cloud
  // Run. Never on a server that drains itself, so it cannot call itself.
  const createDrainForwarder = () => {
    const forward = config ? null : getDrainForwardConfig();
    return forward ? new DrainForwarder(forward) : null;
  };
  return {
    config,
    jobs,
    createDrain,
    createDrainTrigger,
    createDrainForwarder,
  };
}
