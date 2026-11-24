import type { LogDate } from "../../domain/calendar/value-objects/log-date";

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1_000;

// The LIKE pattern (used with ESCAPE '\') that matches any text containing
// term literally: the escape character and the wildcards are escaped.
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// [start, end) of a Japan date as UTC instants: JST midnight of the date and
// of the next one. The columns hold UTC, so these compare with them directly.
export function jstDayRange(date: LogDate): { start: Date; end: Date } {
  const midnight = (day: number) =>
    new Date(Date.UTC(date.year, date.month - 1, day) - TOKYO_OFFSET_MS);
  return { start: midnight(date.day), end: midnight(date.day + 1) };
}
