import type { LogDate } from "@/domain/calendar/value-objects/log-date";
import type { LearningEntry } from "@/domain/learning/entities/learning-entry";

import {
  goApiAuthed,
  goUploadAuthed,
  withUserParam,
  type GoApiCall,
  type GoUploadCall,
} from "./authed";
import { GoApiError } from "./client";
import { toDate, toLearningEntry, type GoEntryJson } from "./learning-json";

// Whose notes are read. Only another member's notes (an admin's view) add
// ?user=; the user's own notes are the token's owner in Go.
export type ViewedOwner = { kind: "self" | "other"; ownerId: string };

export type RecentLearningEntries = { entries: LearningEntry[]; total: number };

export type LogDateSummary = { date: LogDate; count: number };

export type DailyLearningEntry = { entry: LearningEntry; total: number };

export type TrashedLearningEntry = LearningEntry & { deletedAt: Date };

export type TrashedLearningEntries = {
  entries: TrashedLearningEntry[];
  total: number;
};

type EntriesJson = { entries: GoEntryJson[]; total: number };
type PagedEntriesJson = EntriesJson & { nextCursor?: string | null };
type LogDatesJson = { dates: { date: string; count: number }[] };
type DailyEntriesJson = { entries: GoEntryJson[] };
type DailyEntryJson = { entry: GoEntryJson; total: number };
type TrashJson = {
  entries: (GoEntryJson & { deletedAt: string })[];
  total: number;
};

// The trash page lists one page of notes.
const TRASH_LIST_LIMIT = 100;

// The export reads Go's largest page (100) up to 100 times: 10,000 notes.
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_PAGES = 100;

export function createLearningGateway(
  call: GoApiCall = goApiAuthed,
  upload: GoUploadCall = goUploadAuthed,
) {
  const read = <T>(path: string, owner: ViewedOwner) =>
    call<T>(
      withUserParam(path, owner.kind === "other" ? owner.ownerId : undefined),
      { method: "GET" },
    );

  return {
    async listRecent(
      owner: ViewedOwner,
      limit: number,
    ): Promise<RecentLearningEntries> {
      const json = await read<EntriesJson>(`/v1/entries?limit=${limit}`, owner);
      return { entries: json.entries.map(toLearningEntry), total: json.total };
    },

    // Every one of the signed-in user's own notes, newest first, read page by
    // page; maxPages bounds the loop should Go keep returning a cursor.
    async listAll(maxPages = EXPORT_MAX_PAGES): Promise<LearningEntry[]> {
      const entries: LearningEntry[] = [];
      let cursor: string | null | undefined;
      for (let page = 0; page < maxPages; page++) {
        const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const json = await call<PagedEntriesJson>(
          `/v1/entries?limit=${EXPORT_PAGE_SIZE}${query}`,
          { method: "GET" },
        );
        entries.push(...json.entries.map(toLearningEntry));
        cursor = json.nextCursor;
        if (!cursor) break;
      }
      return entries;
    },

    // Go groups the notes by Japan date, newest first.
    async listLogDates(owner: ViewedOwner): Promise<LogDateSummary[]> {
      const json = await read<LogDatesJson>("/v1/log-dates", owner);
      return json.dates.map(({ date, count }) => ({
        date: parseGoDate(date),
        count,
      }));
    },

    async listDailyEntries(
      owner: ViewedOwner,
      date: LogDate,
    ): Promise<LearningEntry[]> {
      const json = await read<DailyEntriesJson>(
        `/v1/log-dates/${formatGoDate(date)}/entries`,
        owner,
      );
      return json.entries.map(toLearningEntry);
    },

    // null when the owner has no such note that day.
    async getDailyEntry(
      owner: ViewedOwner,
      date: LogDate,
      entryNumber: number,
    ): Promise<DailyLearningEntry | null> {
      try {
        const json = await read<DailyEntryJson>(
          `/v1/log-dates/${formatGoDate(date)}/entries/${entryNumber}`,
          owner,
        );
        return { entry: toLearningEntry(json.entry), total: json.total };
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404) return null;
        throw error;
      }
    },

    // The writes below act on the signed-in user's own notes (the token's
    // owner in Go) and never add ?user=. Each returns false when Go answers
    // 404: the user has no such note in the expected state.
    trash(id: string): Promise<boolean> {
      return found(write(`/v1/entries/${encodeURIComponent(id)}`, "DELETE"));
    },

    restore(id: string): Promise<boolean> {
      return found(
        write(`/v1/trash/${encodeURIComponent(id)}/restore`, "POST"),
      );
    },

    purge(id: string): Promise<boolean> {
      return found(write(`/v1/trash/${encodeURIComponent(id)}`, "DELETE"));
    },

    // How many notes were deleted for good.
    async emptyTrash(): Promise<number> {
      const json = await call<{ deleted: number }>("/v1/trash", {
        method: "DELETE",
      });
      return json.deleted;
    },

    // Newest in the trash first, as Go orders it (deletedAt, then id, desc).
    async listTrashed(): Promise<TrashedLearningEntries> {
      const json = await call<TrashJson>(
        `/v1/trash?limit=${TRASH_LIST_LIMIT}`,
        { method: "GET" },
      );
      return {
        entries: json.entries.map((entry) => ({
          ...toLearningEntry(entry),
          deletedAt: toDate(entry.deletedAt),
        })),
        total: json.total,
      };
    },

    // Go keeps the first sharedAt when a shared note is shared again.
    setShared(id: string, shared: boolean): Promise<boolean> {
      return found(
        write(
          `/v1/entries/${encodeURIComponent(id)}/share`,
          shared ? "PUT" : "DELETE",
        ),
      );
    },

    // Go checks and stores the CSV in the signed-in user's own notes and
    // answers how many notes it added.
    async importCsv(file: File): Promise<number> {
      const form = new FormData();
      form.set("csvFile", file, file.name);
      const json = await upload<{ count: number }>("/v1/imports/csv", form);
      return json.count;
    },
  };

  function write(path: string, method: string) {
    return call<unknown>(path, { method });
  }
}

async function found(request: Promise<unknown>): Promise<boolean> {
  try {
    await request;
    return true;
  } catch (error) {
    if (error instanceof GoApiError && error.status === 404) return false;
    throw error;
  }
}

export type LearningGateway = ReturnType<typeof createLearningGateway>;

// Go writes dates as zero-padded YYYY-MM-DD.
function formatGoDate({ year, month, day }: LogDate) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseGoDate(value: string): LogDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("invalid log date in Go JSON");
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}
