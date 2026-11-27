import type { LogDate } from "../../domain/calendar/value-objects/log-date";
import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import type { LearningEntry } from "../../domain/learning/entities/learning-entry";
import type { EntrySearch } from "../../domain/learning/entry-search";
import {
  CsvValidationError,
  type LearningCsvDraft,
} from "../../domain/learning/learning-csv";
import type {
  DailyLearningEntry,
  LogDateSummary,
  RecentLearningEntries,
  TrashedLearningEntries,
} from "../../domain/learning/learning-note-views";
import type { ViewedOwner } from "../../domain/learning/viewed-owner";

// The signed-in user may not do this: signed out, a guest, reading another
// member's notes without being an admin, or sharing while not a member (an
// admin, or the demo).
export class LearningForbiddenError extends Error {
  override name = "LearningForbiddenError";
}

// On failure, message is a CsvValidationError's message.
export type CsvImportResult =
  { ok: true; count: number } | { ok: false; message: string };

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
  // A note's place in its owner's review queue. isEntryInReview is null and
  // the others false when the owner has no such live note.
  entryReviews: {
    isEntryInReview(ownerId: string, id: string): Promise<boolean | null>;
    addEntry(ownerId: string, id: string, now: Date): Promise<boolean>;
    removeEntry(ownerId: string, id: string): Promise<boolean>;
  };
  now: () => Date;
  // The CSV import: the checks and the parser throw CsvValidationError (or,
  // for checkFile, return its message) with the text to show the user.
  csvImport: {
    // The checks made before the file is read; null when it may be read.
    checkFile(file: { name: string; size: number }): string | null;
    parse(text: string): LearningCsvDraft[];
    // The file name stored with the batch.
    fileName(name: string): string;
    // Stores every draft or none; returns how many notes were added.
    importBatch(
      ownerId: string,
      fileName: string,
      drafts: LearningCsvDraft[],
    ): Promise<number>;
  };
};

// Whose learning notes are read and changed. Reads follow the owner the page
// chose, re-checked here; writes always act on the signed-in user's own
// notes (the member an admin impersonates), never on an owner from a form.
export function createLearningNotes(deps: LearningNotesDeps) {
  async function signedIn(): Promise<AuthenticatedUser> {
    const user = await deps.currentUser();
    if (!user || !isMemberRole(user.role)) throw new LearningForbiddenError();
    return user;
  }

  // The signed-in user's own id, or another member's for an admin.
  async function viewed(owner: ViewedOwner): Promise<string> {
    const user = await signedIn();
    if (owner.kind === "self") return user.userId;
    if (user.role !== "admin") throw new LearningForbiddenError();
    return owner.ownerId;
  }

  async function own(): Promise<string> {
    return (await signedIn()).userId;
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

    // Whether the signed-in user's own note is in their review queue (the
    // demo has a queue too); null when the note is not theirs or is in the
    // trash.
    isInReview: async (id: string): Promise<boolean | null> =>
      deps.entryReviews.isEntryInReview(await own(), id),

    // Puts the note in as a new card due now, keeping the card of a note
    // already there, or takes it out with its answers. False when the user
    // has no such live note.
    async setInReview(id: string, inReview: boolean): Promise<boolean> {
      const ownerId = await own();
      return inReview
        ? deps.entryReviews.addEntry(ownerId, id, deps.now())
        : deps.entryReviews.removeEntry(ownerId, id);
    },

    // Only members can be followed, so only a member (not an admin, and not
    // the demo) shares notes.
    async setShared(id: string, shared: boolean): Promise<boolean> {
      const user = await signedIn();
      if (user.role !== "member" || user.demo === true)
        throw new LearningForbiddenError();
      return deps.writes.setShared(user.userId, id, shared);
    },

    // Adds the CSV's rows to the signed-in user's own notes (the member an
    // admin impersonates; the demo may import too). A problem with the file comes
    // back as its message and nothing is written; other failures are thrown.
    async importCsv(file: {
      name: string;
      size: number;
      text(): Promise<string>;
    }): Promise<CsvImportResult> {
      const ownerId = await own();
      let fileName: string;
      let drafts: LearningCsvDraft[];
      try {
        const problem = deps.csvImport.checkFile(file);
        if (problem) return { ok: false, message: problem };
        drafts = deps.csvImport.parse(await file.text());
        fileName = deps.csvImport.fileName(file.name);
      } catch (error) {
        if (error instanceof CsvValidationError)
          return { ok: false, message: error.message };
        throw error;
      }
      const count = await deps.csvImport.importBatch(ownerId, fileName, drafts);
      return { ok: true, count };
    },
  };
}

export type LearningNotes = ReturnType<typeof createLearningNotes>;
