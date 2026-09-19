import type { LearningEntryDraft } from "@/domain/learning/entities/learning-entry";

export interface CsvLearningParser {
  parse(source: string): LearningEntryDraft[];
}
