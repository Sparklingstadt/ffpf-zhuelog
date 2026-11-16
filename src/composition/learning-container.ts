import { createLearningNotes } from "@/application/learning/learning-notes";
import { getCachedCurrentUser } from "@/composition/current-user";
import {
  checkCsvFile,
  importFileName,
  parseLearningCsv,
} from "@/infrastructure/csv/learning-csv";
import { createLearningCsvImport } from "@/infrastructure/prisma/learning-csv-import";
import { createLearningNoteReads } from "@/infrastructure/prisma/learning-note-reads";
import { createLearningNoteWrites } from "@/infrastructure/prisma/learning-note-writes";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { createReviewStore } from "@/infrastructure/prisma/review-store";

// Note reads, the trash, sharing, the CSV import and a note's place in the
// review queue are all kept in the database.
export const learningNotes = createLearningNotes({
  currentUser: getCachedCurrentUser,
  reads: createLearningNoteReads(prisma),
  writes: createLearningNoteWrites(prisma),
  entryReviews: createReviewStore(prisma),
  now: () => new Date(),
  csvImport: {
    checkFile: checkCsvFile,
    parse: parseLearningCsv,
    fileName: importFileName,
    ...createLearningCsvImport(prisma),
  },
});
