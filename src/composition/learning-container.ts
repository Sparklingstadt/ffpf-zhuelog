import { EmptyLearningTrash } from "@ffpf-zhuelog/core/application/learning/use-cases/empty-learning-trash";
import { GetDailyEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/get-daily-entry";
import { ImportLearningCsv } from "@ffpf-zhuelog/core/application/learning/use-cases/import-learning-csv";
import { ListDailyEntries } from "@ffpf-zhuelog/core/application/learning/use-cases/list-daily-entries";
import { ListLogDates } from "@ffpf-zhuelog/core/application/calendar/use-cases/list-log-dates";
import { ListRecentEntries } from "@ffpf-zhuelog/core/application/learning/use-cases/list-recent-entries";
import { ListTrashedEntries } from "@ffpf-zhuelog/core/application/learning/use-cases/list-trashed-entries";
import { PurgeLearningEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/purge-learning-entry";
import { RestoreLearningEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/restore-learning-entry";
import { ShareLearningEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/share-learning-entry";
import { TrashLearningEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/trash-learning-entry";
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
  trashLearningEntry: new TrashLearningEntry(repository),
  restoreLearningEntry: new RestoreLearningEntry(repository),
  purgeLearningEntry: new PurgeLearningEntry(repository),
  emptyLearningTrash: new EmptyLearningTrash(repository),
  listTrashedEntries: new ListTrashedEntries(repository),
  shareLearningEntry: new ShareLearningEntry(repository),
};
