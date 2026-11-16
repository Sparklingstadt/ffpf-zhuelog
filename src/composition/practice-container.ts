import { createPracticeRecords } from "@/application/practice/practice-records";
import { getCachedCurrentUser } from "@/composition/current-user";
import { createPracticeRecordStore } from "@/infrastructure/prisma/practice-record-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";

// Completed rounds, read and saved in the database as the signed-in user.
const practiceRecords = createPracticeRecords({
  currentUser: getCachedCurrentUser,
  store: createPracticeRecordStore(prisma),
  now: () => new Date(),
});
export const prepositionRecords = practiceRecords.prepositions;
export const complementRecords = practiceRecords.complements;
