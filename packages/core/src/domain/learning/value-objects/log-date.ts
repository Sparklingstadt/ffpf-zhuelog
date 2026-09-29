const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1_000;

export type LogDate = {
  year: number;
  month: number;
  day: number;
};

export type DateRange = {
  start: Date;
  end: Date;
};

export function parseLogDate(
  year: string,
  month: string,
  day: string,
): LogDate | null {
  if (
    !/^\d{4}$/.test(year) ||
    !/^\d{1,2}$/.test(month) ||
    !/^\d{1,2}$/.test(day)
  ) {
    return null;
  }

  const value = { year: Number(year), month: Number(month), day: Number(day) };
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));

  if (
    value.year < 2000 ||
    value.year > 9999 ||
    date.getUTCFullYear() !== value.year ||
    date.getUTCMonth() !== value.month - 1 ||
    date.getUTCDate() !== value.day
  ) {
    return null;
  }

  return value;
}

export function parseLogNumber(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= 2_147_483_647
    ? number
    : null;
}

export function getTokyoDateRange({ year, month, day }: LogDate): DateRange {
  const start = new Date(Date.UTC(year, month - 1, day) - TOKYO_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1_000) };
}

export function getTokyoDateParts(date: Date): LogDate {
  const tokyo = new Date(date.getTime() + TOKYO_OFFSET_MS);
  return {
    year: tokyo.getUTCFullYear(),
    month: tokyo.getUTCMonth() + 1,
    day: tokyo.getUTCDate(),
  };
}

export function getLogDateKey(date: Date) {
  const { year, month, day } = getTokyoDateParts(date);
  return `${year}/${month}/${day}`;
}
