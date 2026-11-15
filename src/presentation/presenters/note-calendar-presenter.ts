import type { LogDate } from "@/domain/calendar/value-objects/log-date";

export type CalendarMonth = { year: number; month: number };

export type CalendarCell =
  { kind: "blank" } | { kind: "day"; date: LogDate; count: number };

// "2026-09" for ?month=, and back. Anything else is null.
export function formatMonthParam({ year, month }: CalendarMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthParam(value: unknown): CalendarMonth | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 9999 || month < 1 || month > 12) return null;
  return { year, month };
}

export function shiftMonth(
  { year, month }: CalendarMonth,
  by: number,
): CalendarMonth {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

const dateKey = (d: LogDate) => `${d.year}-${d.month}-${d.day}`;

// The month as weeks from Monday: blanks before the 1st and after the last
// day, so the grid is whole weeks. counts are how many notes each date has.
export function monthCells(
  { year, month }: CalendarMonth,
  counts: readonly { date: LogDate; count: number }[],
): CalendarCell[] {
  const byDate = new Map(counts.map((c) => [dateKey(c.date), c.count]));
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Sunday is 0; a Monday-first week puts it last.
  const lead = (first + 6) % 7;
  const cells: CalendarCell[] = Array.from({ length: lead }, () => ({
    kind: "blank",
  }));
  for (let day = 1; day <= days; day++) {
    const date = { year, month, day };
    cells.push({ kind: "day", date, count: byDate.get(dateKey(date)) ?? 0 });
  }
  while (cells.length % 7 !== 0) cells.push({ kind: "blank" });
  return cells;
}
