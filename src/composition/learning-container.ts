import { EmptyLearningTrash } from "@/application/learning/use-cases/empty-learning-trash";
import { ImportLearningCsv } from "@/application/learning/use-cases/import-learning-csv";
import { ListTrashedEntries } from "@/application/learning/use-cases/list-trashed-entries";
import { PurgeLearningEntry } from "@/application/learning/use-cases/purge-learning-entry";
import { RestoreLearningEntry } from "@/application/learning/use-cases/restore-learning-entry";
import { ShareLearningEntry } from "@/application/learning/use-cases/share-learning-entry";
import { TrashLearningEntry } from "@/application/learning/use-cases/trash-learning-entry";
import { createLearningGateway } from "@/infrastructure/go-api/learning-gateway";
import { CsvParseLearningParser } from "@/infrastructure/csv/csv-parse-learning-parser";
import { PrismaLearningEntryRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-learning-entry-repository";

const repository = new PrismaLearningEntryRepository();
const parser = new CsvParseLearningParser();

export const learningUseCases = {
  importLearningCsv: new ImportLearningCsv(parser, repository),
  trashLearningEntry: new TrashLearningEntry(repository),
  restoreLearningEntry: new RestoreLearningEntry(repository),
  purgeLearningEntry: new PurgeLearningEntry(repository),
  emptyLearningTrash: new EmptyLearningTrash(repository),
  listTrashedEntries: new ListTrashedEntries(repository),
  shareLearningEntry: new ShareLearningEntry(repository),
};

// Note reads go through the Go API as the signed-in user.
export const learningReads = createLearningGateway();
