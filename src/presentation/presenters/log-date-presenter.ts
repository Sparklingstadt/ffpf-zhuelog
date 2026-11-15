import type { LogDate } from "@/domain/calendar/value-objects/log-date";
import { getTokyoDateParts } from "@/domain/calendar/value-objects/log-date";

export function getLogDateHref(date: Date | LogDate, basePath = "/logs") {
  const value = date instanceof Date ? getTokyoDateParts(date) : date;
  return `${basePath}/${value.year}/${value.month}/${value.day}`;
}

export function formatLogDate(date: LogDate) {
  return `${date.year}年${date.month}月${date.day}日`;
}

export function formatLogDateKey(date: LogDate) {
  return `${date.year}/${date.month}/${date.day}`;
}

export function formatTokyoDateTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

// 「21:10」: the time of day in Tokyo, for lists already grouped by date.
export function formatTokyoTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

// 「11/12」: the month and day in Tokyo, for short lists of recent things.
export function formatTokyoMonthDay(date: Date) {
  const { month, day } = getTokyoDateParts(date);
  return `${month}/${day}`;
}
