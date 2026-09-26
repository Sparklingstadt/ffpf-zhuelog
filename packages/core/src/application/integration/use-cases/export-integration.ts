import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";
import type {
  Integration,
  IntegrationFile,
} from "../../../integration/integration";
import { INTEGRATION_SOURCE_LIMIT } from "./integration-source-limit";

// The name goes inside a quoted Content-Disposition parameter.
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;

export class ExportIntegration {
  constructor(private readonly repository: LearningEntryRepository) {}

  async execute(integration: Integration): Promise<IntegrationFile | null> {
    const { entries } = await this.repository.listRecent(
      INTEGRATION_SOURCE_LIMIT,
    );
    const file = integration.export(entries);
    if (file && !FILE_NAME.test(file.fileName))
      throw new Error("INVALID_INTEGRATION_FILE_NAME");
    return file;
  }
}
