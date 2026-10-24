import type { ConversationSummary } from "@/domain/chat/conversation";
import {
  getTokyoDateParts,
  type LogDate,
} from "@/domain/calendar/value-objects/log-date";

const sameDate = (a: LogDate, b: LogDate) =>
  a.year === b.year && a.month === b.month && a.day === b.day;

// Days (in Tokyo) that have conversations, newest first. items come newest
// first from Go.
export function listConversationDates(
  items: ConversationSummary[],
): { date: LogDate; count: number }[] {
  const days: { date: LogDate; count: number }[] = [];
  for (const item of items) {
    const date = getTokyoDateParts(item.createdAt);
    const last = days.at(-1);
    if (last && sameDate(last.date, date)) last.count += 1;
    else days.push({ date, count: 1 });
  }
  return days;
}

// The day's conversations oldest first, numbered from 1 as in their URLs.
export function conversationsOn(
  items: ConversationSummary[],
  date: LogDate,
): (ConversationSummary & { number: number })[] {
  return items
    .filter((item) => sameDate(getTokyoDateParts(item.createdAt), date))
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((item, index) => ({ ...item, number: index + 1 }));
}
