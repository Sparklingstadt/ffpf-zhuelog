import { ImportLearningCsv } from "@/application/learning/use-cases/import-learning-csv";
import { createLearningGateway } from "@/infrastructure/go-api/learning-gateway";
import { CsvParseLearningParser } from "@/infrastructure/csv/csv-parse-learning-parser";
import { PrismaLearningEntryRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-learning-entry-repository";

const repository = new PrismaLearningEntryRepository();
const parser = new CsvParseLearningParser();

export const learningUseCases = {
  importLearningCsv: new ImportLearningCsv(parser, repository),
};

// Note reads, the trash and sharing go through the Go API as the signed-in
// user.
export const learningNotes = createLearningGateway();
