import type { LogDate } from "../../domain/calendar/value-objects/log-date";
import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import type { LearningEntry } from "../../domain/learning/entities/learning-entry";
import type { EntrySearch } from "../../domain/learning/entry-search";
import type {
  DailyLearningEntry,
  LogDateSummary,
  RecentLearningEntries,
  TrashedLearningEntries,
} from "../../domain/learning/learning-note-views";
import type { ViewedOwner } from "../../domain/learning/viewed-owner";

// The signed-in user may not do this: signed out, a guest, revoked, without
// an owner id, reading another member's notes without being an admin, or
// sharing while not a plain member.
export class LearningForbiddenError extends Error {
  override name = "LearningForbiddenError";
}

export type LearningNotesDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  // Every read and write names the owner whose notes it touches.
  reads: {
    listRecent(
      ownerId: string,
      limit: number,
      search?: EntrySearch,
    ): Promise<RecentLearningEntries>;
    listAll(ownerId: string): Promise<LearningEntry[]>;
    listLogDates(ownerId: string): Promise<LogDateSummary[]>;
    listDailyEntries(ownerId: string, date: LogDate): Promise<LearningEntry[]>;
    getDailyEntry(
      ownerId: string,
      date: LogDate,
      number: number,
    ): Promise<{ entry: LearningEntry; total: number } | null>;
    listTrashed(ownerId: string): Promise<TrashedLearningEntries>;
  };
  // Each returns false (emptyTrash: 0) when the owner has no such note in
  // the expected state.
  writes: {
    trash(ownerId: string, id: string): Promise<boolean>;
    restore(ownerId: string, id: string): Promise<boolean>;
    purge(ownerId: string, id: string): Promise<boolean>;
    emptyTrash(ownerId: string): Promise<number>;
    setShared(ownerId: string, id: string, shared: boolean): Promise<boolean>;
  };
};

// Whose learning notes are read and changed. Reads follow the owner the page
// chose, re-checked here; writes always act on the signed-in user's own
// notes (the member an admin acts as), never on an owner from a form.
export function createLearningNotes(deps: LearningNotesDeps) {
  async function signedIn(): Promise<AuthenticatedUser & { githubId: string }> {
    const user = await deps.currentUser();
    if (!user || !isMemberRole(user.role) || !user.githubId)
      throw new LearningForbiddenError();
    return { ...user, githubId: user.githubId };
  }

  // The signed-in user's own id, or another member's for an admin.
  async function viewed(owner: ViewedOwner): Promise<string> {
    const user = await signedIn();
    if (owner.kind === "self") return user.githubId;
    if (user.role !== "admin") throw new LearningForbiddenError();
    return owner.ownerId;
  }

  async function own(): Promise<string> {
    return (await signedIn()).githubId;
  }

  return {
    // The newest notes, or with a search only the ones that match it; total
    // counts every note the search matches.
    async listRecent(
      owner: ViewedOwner,
      limit: number,
      search?: EntrySearch,
    ): Promise<RecentLearningEntries> {
      return deps.reads.listRecent(await viewed(owner), limit, search);
    },

    // Every one of the signed-in user's own notes, newest first.
    async listAll(): Promise<LearningEntry[]> {
      return deps.reads.listAll(await own());
    },

    // The Japan dates with notes, newest first.
    async listLogDates(owner: ViewedOwner): Promise<LogDateSummary[]> {
      return deps.reads.listLogDates(await viewed(owner));
    },

    async listDailyEntries(
      owner: ViewedOwner,
      date: LogDate,
    ): Promise<LearningEntry[]> {
      return deps.reads.listDailyEntries(await viewed(owner), date);
    },

    // null when the owner has no such note that day.
    async getDailyEntry(
      owner: ViewedOwner,
      date: LogDate,
      entryNumber: number,
    ): Promise<DailyLearningEntry | null> {
      const found = await deps.reads.getDailyEntry(
        await viewed(owner),
        date,
        entryNumber,
      );
      return found ? { entry: found.entry, total: found.total } : null;
    },

    trash: async (id: string): Promise<boolean> =>
      deps.writes.trash(await own(), id),

    restore: async (id: string): Promise<boolean> =>
      deps.writes.restore(await own(), id),

    purge: async (id: string): Promise<boolean> =>
      deps.writes.purge(await own(), id),

    // How many notes were deleted for good.
    emptyTrash: async (): Promise<number> =>
      deps.writes.emptyTrash(await own()),

    // Newest in the trash first.
    listTrashed: async (): Promise<TrashedLearningEntries> =>
      deps.reads.listTrashed(await own()),

    // Only members can be followed, so only a plain member (not an admin,
    // even acting as one, and not the demo) shares notes.
    async setShared(id: string, shared: boolean): Promise<boolean> {
      const user = await signedIn();
      if (user.role !== "member" || user.demo === true)
        throw new LearningForbiddenError();
      return deps.writes.setShared(user.githubId, id, shared);
    },
  };
}

export type LearningNotes = ReturnType<typeof createLearningNotes>;
