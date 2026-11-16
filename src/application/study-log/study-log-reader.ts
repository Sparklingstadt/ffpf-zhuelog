import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import { studyLogRange, type StudyDay } from "../../domain/study-log/study-log";

// The signed-in user has no study log: signed out, a guest, revoked or
// without an owner id.
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
// user is refused before the range is checked, as Go answered 403 before 400.
export function createStudyLogReader(deps: StudyLogReaderDeps) {
  return {
    // Japan dates from..to ("YYYY-MM-DD", both included) that have anything,
    // oldest first. RangeError when Go would have answered 400.
    async list(from: string, to: string): Promise<StudyDay[]> {
      const user = await deps.currentUser();
      if (!user || !isMemberRole(user.role) || !user.githubId)
        throw new StudyLogForbiddenError();
      const range = studyLogRange(from, to);
      if (!range) throw new RangeError("not a study log range");
      return deps.store.days(user.githubId, range.start, range.end);
    },
  };
}
