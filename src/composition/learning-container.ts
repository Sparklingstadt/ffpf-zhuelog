import { createLearningNotes } from "@/application/learning/learning-notes";
import { getCachedCurrentUser } from "@/composition/current-user";
import { createLearningGateway } from "@/infrastructure/go-api/learning-gateway";
import { createLearningNoteReads } from "@/infrastructure/prisma/learning-note-reads";
import { createLearningNoteWrites } from "@/infrastructure/prisma/learning-note-writes";
import { prisma } from "@/infrastructure/prisma/prisma-client";

const notes = createLearningNotes({
  currentUser: getCachedCurrentUser,
  reads: createLearningNoteReads(prisma),
  writes: createLearningNoteWrites(prisma),
});

// The review queue status and the CSV import still go through the Go API as
// the signed-in user.
const goGateway = createLearningGateway();

// Note reads, the trash and sharing are kept in the database; the rest still
// goes through Go.
export const learningNotes = {
  ...notes,
  isInReview: goGateway.isInReview,
  setInReview: goGateway.setInReview,
  importCsv: goGateway.importCsv,
};
