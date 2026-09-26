import { ExportIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/export-integration";
import { PreviewIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/preview-integration";
import { createIntegrationRegistry } from "@ffpf-zhuelog/core/integration";
import typleIntegration from "@ffpf-zhuelog/typle-integrate-plugin";

import { PrismaLearningEntryRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-learning-entry-repository";

// The only place in the app that knows which plugins are installed.
export const integrations = createIntegrationRegistry([typleIntegration]);

const repository = new PrismaLearningEntryRepository();

export const integrationUseCases = {
  previewIntegration: new PreviewIntegration(repository),
  exportIntegration: new ExportIntegration(repository),
};
