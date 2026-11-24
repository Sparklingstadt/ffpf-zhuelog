// Counting review days in Japan time (UTC+9, no daylight saving). Dates are
// Japan calendar dates as "YYYY-MM-DD".

// How far back the streak reads the owner's answers, in days.
export const REVIEW_HISTORY_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// The Japan calendar date of an instant.
export function japanDate(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

// UTC midnight of `date` as a timestamp; the arithmetic below works on it so
// months and years roll over by themselves.
function utcMidnight(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("not a YYYY-MM-DD date");
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function daysBefore(date: string, days: number): string {
  return new Date(utcMidnight(date) - days * DAY_MS).toISOString().slice(0, 10);
}

// JST midnight of the date `daysBack` days before `today`, as a UTC instant.
export function japanMidnightBefore(today: string, daysBack: number): Date {
  return new Date(utcMidnight(today) - daysBack * DAY_MS - JST_OFFSET_MS);
}

// Days in a row with a review, ending today or yesterday; 0 otherwise. A
// streak whose last day is yesterday still counts, so it does not drop to 0
// until a whole day goes by without a review.
export function reviewStreak(
  today: string,
  reviewed: readonly string[],
): number {
  const days = new Set(reviewed);
  let want = today;
  if (!days.has(want)) {
    want = daysBefore(today, 1);
    if (!days.has(want)) return 0;
  }
  let n = 0;
  while (days.has(want)) {
    n += 1;
    want = daysBefore(want, 1);
  }
  return n;
}

// Whether each of the `count` days up to today had a review, oldest first;
// the last is today. Dates outside the window are ignored.
export function recentReviewDays(
  today: string,
  reviewed: readonly string[],
  count = 7,
): boolean[] {
  const days = new Set(reviewed);
  return Array.from({ length: count }, (_, i) =>
    days.has(daysBefore(today, count - 1 - i)),
  );
}
