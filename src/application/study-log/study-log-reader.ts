import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import { studyLogRange, type StudyDay } from "../../domain/study-log/study-log";

// The signed-in user has no study log: signed out or a guest.
export class StudyLogForbiddenError extends Error {
  override name = "StudyLogForbiddenError";
}

export type StudyLogReaderDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  // The owner's days with anything in [start, end), oldest first.
  store: {
    days(ownerId: string, start: Date, end: Date): Promise<StudyDay[]>;
  };
};

// The study log, always the signed-in user's own (the member an admin acts
// as; the demo has its own too). The owner is decided first, so a refused
// user is refused before the range is checked.
export function createStudyLogReader(deps: StudyLogReaderDeps) {
  return {
    // Japan dates from..to ("YYYY-MM-DD", both included) that have anything,
    // oldest first. RangeError when the range is not valid (studyLogRange).
    async list(from: string, to: string): Promise<StudyDay[]> {
      const user = await deps.currentUser();
      if (!user || !isMemberRole(user.role)) throw new StudyLogForbiddenError();
      const range = studyLogRange(from, to);
      if (!range) throw new RangeError("not a study log range");
      return deps.store.days(user.userId, range.start, range.end);
    },
  };
}
