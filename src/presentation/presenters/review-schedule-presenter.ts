import { getTokyoDateParts } from "@/domain/calendar/value-objects/log-date";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long until `to`, as a rating button says it: 「10分後」「3時間後」
// 「4日後」「2か月後」「1.5年後」. Rounded, and never under 1 minute.
export function formatInterval(from: Date, to: Date): string {
  const ms = Math.max(0, to.getTime() - from.getTime());
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}分後`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}時間後`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days}日後`;
  if (days < 365) return `${Math.round(days / 30)}か月後`;
  return `${Math.round((days / 365) * 10) / 10}年後`;
}

// The days between two Tokyo dates, counting calendar days.
function tokyoDayNumber(date: Date): number {
  const { year, month, day } = getTokyoDateParts(date);
  return Date.UTC(year, month - 1, day) / DAY;
}

// When a word comes back, by Tokyo calendar day: 「今日」 (due or overdue),
// 「明日」, or 「11/20」 (「2027/1/5」 in another year).
export function formatNextReview(due: Date, now: Date): string {
  const days = tokyoDayNumber(due) - tokyoDayNumber(now);
  if (days <= 0) return "今日";
  if (days === 1) return "明日";
  const d = getTokyoDateParts(due);
  return d.year === getTokyoDateParts(now).year
    ? `${d.month}/${d.day}`
    : `${d.year}/${d.month}/${d.day}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export type RecentDay = {
  // 「火」, or 「今日」 for the last.
  label: string;
  // 「11/5（水）」, for screen readers.
  date: string;
  reviewed: boolean;
};

// The last days up to today in Tokyo, oldest first, labelled for the row of
// squares on the home: reviewed[i] is the i-th of them.
export function recentDays(
  reviewed: readonly boolean[],
  now: Date,
): RecentDay[] {
  const today = tokyoDayNumber(now);
  return reviewed.map((was, i) => {
    const day = new Date((today - (reviewed.length - 1 - i)) * DAY);
    const weekday = WEEKDAYS[day.getUTCDay()];
    const last = i === reviewed.length - 1;
    return {
      label: last ? "今日" : weekday,
      date: `${day.getUTCMonth() + 1}/${day.getUTCDate()}（${weekday}）`,
      reviewed: was,
    };
  });
}

// The kinds of review items, grouped as the home lists them.
export const REVIEW_KIND_GROUPS = [
  { label: "学習ノート", kinds: ["entry"] },
  { label: "練習の間違い", kinds: ["preposition", "complement"] },
  { label: "単語帳", kinds: ["vocabulary"] },
] as const;

// How many are due in each group, leaving out empty groups. Kinds outside
// the groups count as practice.
export function dueByGroup(
  byKind: Readonly<Record<string, number>>,
): { label: string; count: number }[] {
  const known = new Set<string>(REVIEW_KIND_GROUPS.flatMap((g) => g.kinds));
  return REVIEW_KIND_GROUPS.map((group) => ({
    label: group.label,
    count:
      group.kinds.reduce((sum, kind) => sum + (byKind[kind] ?? 0), 0) +
      (group.label === "練習の間違い"
        ? Object.entries(byKind)
            .filter(([kind]) => !known.has(kind))
            .reduce((sum, [, n]) => sum + n, 0)
        : 0),
  })).filter((group) => group.count > 0);
}
