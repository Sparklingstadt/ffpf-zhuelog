import { GetDailyEntry } from "@/application/learning/use-cases/get-daily-entry";
import { ImportLearningCsv } from "@/application/learning/use-cases/import-learning-csv";
import { ListDailyEntries } from "@/application/learning/use-cases/list-daily-entries";
import { ListLogDates } from "@/application/learning/use-cases/list-log-dates";
import { ListRecentEntries } from "@/application/learning/use-cases/list-recent-entries";
import { CsvParseLearningParser } from "@/infrastructure/csv/csv-parse-learning-parser";
import { PrismaLearningEntryRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-learning-entry-repository";

const repository = new PrismaLearningEntryRepository();
const parser = new CsvParseLearningParser();

export const learningUseCases = {
  importLearningCsv: new ImportLearningCsv(parser, repository),
  listRecentEntries: new ListRecentEntries(repository),
  listLogDates: new ListLogDates(repository),
  listDailyEntries: new ListDailyEntries(repository),
  getDailyEntry: new GetDailyEntry(repository),
};
