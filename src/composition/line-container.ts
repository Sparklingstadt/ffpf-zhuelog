import { DrainLineJobs } from "@ffpf-zhuelog/core/application/line/use-cases/drain-line-jobs";
import { ProcessLineLearning } from "@ffpf-zhuelog/core/application/line/use-cases/process-line-learning";
import { getLineConfig } from "@/infrastructure/line/config";
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
          ),
          new OpenAiLineLearningGenerator(process.env.OPENAI_API_KEY ?? ""),
          config.userId,
        )
      : null;
  return { config, jobs, createDrain };
}
