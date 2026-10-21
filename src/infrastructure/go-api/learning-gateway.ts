import type { LogDate } from "@/domain/calendar/value-objects/log-date";
import type { LearningEntry } from "@/domain/learning/entities/learning-entry";

import { goApiAuthed, withUserParam } from "./authed";
import { GoApiError, type GoApiInit } from "./client";
import { toLearningEntry, type GoEntryJson } from "./learning-json";

// How the gateway reaches Go. Pages use goApiAuthed; tests pass a fake.
export type GoApiCall = <T>(
  path: string,
  init: Omit<GoApiInit, "accessToken">,
) => Promise<T>;

// Whose notes are read. Only another member's notes (an admin's view) add
// ?user=; the user's own notes are the token's owner in Go.
export type ViewedOwner = { kind: "self" | "other"; ownerId: string };

export type RecentLearningEntries = { entries: LearningEntry[]; total: number };

export type LogDateSummary = { date: LogDate; count: number };

export type DailyLearningEntry = { entry: LearningEntry; total: number };

type EntriesJson = { entries: GoEntryJson[]; total: number };
type LogDatesJson = { dates: { date: string; count: number }[] };
type DailyEntriesJson = { entries: GoEntryJson[] };
type DailyEntryJson = { entry: GoEntryJson; total: number };

export function createLearningGateway(call: GoApiCall = goApiAuthed) {
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
  };
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
