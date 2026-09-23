import { ProcessLineLearning } from "@/application/line/use-cases/process-line-learning";
import { getLineConfig } from "@/infrastructure/line/config";
import { LinePushMessenger } from "@/infrastructure/line/line-messenger";
import { PrismaLineJobRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-line-job-repository";

export function createLineContainer() {
  const config = getLineConfig();
  const jobs = new PrismaLineJobRepository();
  return {
    config,
    jobs,
    service: new ProcessLineLearning(
      jobs,
      new LinePushMessenger(config?.accessToken ?? ""),
    ),
  };
}
