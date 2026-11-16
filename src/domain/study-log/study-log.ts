// What the signed-in user did on one Japan date ("YYYY-MM-DD"), as the web
// counts it.
export type StudyDay = {
  date: string;
  reviews: number;
  practiceQuestions: number;
  notes: number;
  words: number;
};

export type YearMonth = { year: number; month: number };

export type CalendarCell = { date: string; day: number; inMonth: boolean };

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(year: number, month: number, day: number): string {
  // Date.UTC normalises overflow (day 0, month 13) into a real date.
  const d = new Date(Date.UTC(year, month - 1, day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function formatMonth({ year, month }: YearMonth): string {
  return `${year}-${pad(month)}`;
}

// "2026-11" → { year: 2026, month: 11 }; anything else, or a year outside
// 2000..9999, → null.
export function parseMonth(value: unknown): YearMonth | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || month < 1 || month > 12) return null;
  return { year, month };
}

export function shiftMonth({ year, month }: YearMonth, by: number): YearMonth {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// Today in Japan (UTC+9, no daylight saving), as "YYYY-MM-DD".
export function todayInJapan(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return formatDate(
    jst.getUTCFullYear(),
    jst.getUTCMonth() + 1,
    jst.getUTCDate(),
  );
}

export function monthOf(date: string): YearMonth {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

// The month's calendar in weeks from Monday to Sunday, with the days of the
// months around it that fill the first and last weeks.
export function monthGrid({ year, month }: YearMonth): CalendarCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay: 0 Sunday … 6 Saturday; Monday-first offset.
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = Math.ceil((lead + daysInMonth) / 7) * 7;
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cellCount; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    const cell = {
      date: formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1,
    };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(cell);
  }
  return weeks;
}

export function studyTotal(day: StudyDay): number {
  return day.reviews + day.practiceQuestions + day.notes + day.words;
}

// 0 for nothing, then 1 to 4 as the day's total grows.
export function studyLevel(total: number): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0) return 0;
  if (total < 10) return 1;
  if (total < 30) return 2;
  if (total < 60) return 3;
  return 4;
}

export type StudySummary = Omit<StudyDay, "date"> & { activeDays: number };

// The sums over days, and how many of them had anything.
export function summarize(days: readonly StudyDay[]): StudySummary {
  const sum: StudySummary = {
    reviews: 0,
    practiceQuestions: 0,
    notes: 0,
    words: 0,
    activeDays: 0,
  };
  for (const d of days) {
    sum.reviews += d.reviews;
    sum.practiceQuestions += d.practiceQuestions;
    sum.notes += d.notes;
    sum.words += d.words;
    if (studyTotal(d) > 0) sum.activeDays++;
  }
  return sum;
}

// Go: maxStudyLogDays. The longest range one read covers, both ends included.
export const STUDY_LOG_MAX_DAYS = 93;

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// Midnight UTC of a zero-padded real date of 2000..9999, else null.
function strictDate(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 2000 || year > 9999) return null;
  const time = Date.UTC(year, month - 1, day);
  const d = new Date(time);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return time;
}

// [start, end) of the Japan dates from..to as instants, or null when Go
// would have answered 400: either is not a zero-padded real date of
// 2000..9999, to is before from, or the range is over 93 days.
// Go: parseLogDate + listStudyLog's checks + LogDate.dayRange.
export function studyLogRange(
  from: string,
  to: string,
): { start: Date; end: Date } | null {
  const first = strictDate(from);
  const last = strictDate(to);
  if (first === null || last === null || last < first) return null;
  if ((last - first) / DAY_MS >= STUDY_LOG_MAX_DAYS) return null;
  return {
    start: new Date(first - JST_OFFSET_MS),
    end: new Date(last + DAY_MS - JST_OFFSET_MS),
  };
}
