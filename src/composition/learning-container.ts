import { createLearningNotes } from "@/application/learning/learning-notes";
import { getCachedCurrentUser } from "@/composition/current-user";
import {
  checkCsvFile,
  importFileName,
  parseLearningCsv,
} from "@/infrastructure/csv/learning-csv";
import { createLearningGateway } from "@/infrastructure/go-api/learning-gateway";
import { createLearningCsvImport } from "@/infrastructure/prisma/learning-csv-import";
import { createLearningNoteReads } from "@/infrastructure/prisma/learning-note-reads";
import { createLearningNoteWrites } from "@/infrastructure/prisma/learning-note-writes";
import { prisma } from "@/infrastructure/prisma/prisma-client";

const notes = createLearningNotes({
  currentUser: getCachedCurrentUser,
  reads: createLearningNoteReads(prisma),
  writes: createLearningNoteWrites(prisma),
  csvImport: {
    checkFile: checkCsvFile,
    parse: parseLearningCsv,
    fileName: importFileName,
    ...createLearningCsvImport(prisma),
  },
});

// Only the review queue status still goes through the Go API as the
// signed-in user.
const goGateway = createLearningGateway();

// Note reads, the trash, sharing and the CSV import are kept in the
// database; putting a note in or out of review still goes through Go.
export const learningNotes = {
  ...notes,
  isInReview: goGateway.isInReview,
  setInReview: goGateway.setInReview,
};
