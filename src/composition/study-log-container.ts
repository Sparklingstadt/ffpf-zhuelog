import { createStudyLogReader } from "@/application/study-log/study-log-reader";
import { getCachedCurrentUser } from "@/composition/current-user";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { createStudyLogStore } from "@/infrastructure/prisma/study-log-store";

// The study log, read in the database as the signed-in user.
export const studyLog = createStudyLogReader({
  currentUser: getCachedCurrentUser,
  store: createStudyLogStore(prisma),
});
