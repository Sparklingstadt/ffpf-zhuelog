import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";
import type { Integration } from "../../../integration/integration";
import { INTEGRATION_SOURCE_LIMIT } from "./integration-source-limit";

export class PreviewIntegration {
  constructor(private readonly repository: LearningEntryRepository) {}

  async execute(ownerId: string, integration: Integration) {
    const { entries, total } = await this.repository.listRecent(
      ownerId,
      INTEGRATION_SOURCE_LIMIT,
    );
    return {
      sourceCount: entries.length,
      total,
      preview: integration.preview(entries),
    };
  }
}
