import type { CsvLearningParser } from "@/application/learning/ports/csv-learning-parser";
import type { LearningEntryRepository } from "@/domain/learning/repositories/learning-entry-repository";

export class ImportLearningCsv {
  constructor(
    private readonly parser: CsvLearningParser,
    private readonly repository: LearningEntryRepository,
  ) {}

  async execute(fileName: string, source: string) {
    const entries = this.parser.parse(source);
    return this.repository.importBatch(fileName.slice(0, 255), entries);
  }
}
