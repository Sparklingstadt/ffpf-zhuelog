import { BookA, BookOpenText, ListChecks, Repeat } from "lucide-react";
import Link from "next/link";

import type { StudyDay } from "@/domain/study-log/study-log";
import { Card, CardContent } from "@/presentation/components/ui/card";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

// 「11月11日（水）」 from "2026-11-11".
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日（${weekday}）`;
}

// What was done on the day picked in the calendar, with the way to that
// day's learning notes when there are any.
export function SelectedDay({
  date,
  day,
}: {
  date: string;
  day: StudyDay | undefined;
}) {
  const [y, m, d] = date.split("-").map(Number);
  const rows = [
    { icon: Repeat, label: "復習", value: `${day?.reviews ?? 0}回` },
    {
      icon: ListChecks,
      label: "練習",
      value: `${day?.practiceQuestions ?? 0}問`,
    },
    { icon: BookOpenText, label: "ノート", value: `${day?.notes ?? 0}件` },
    { icon: BookA, label: "単語", value: `${day?.words ?? 0}語` },
  ];
  return (
    <Card className="gap-2 py-5" aria-labelledby="selected-day">
      <CardContent className="flex flex-col gap-1">
        <h2 id="selected-day" className="mb-1 text-base font-semibold">
          {dayLabel(date)}
        </h2>
        <ul>
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-center gap-3 border-t py-2.5 text-sm"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <row.icon className="size-4" aria-hidden="true" />
              </span>
              <span className="flex-1">{row.label}</span>
              <span className="font-semibold tabular-nums">{row.value}</span>
            </li>
          ))}
        </ul>
        {day && day.notes > 0 ? (
          <Link
            href={`/logs/${y}/${m}/${d}`}
            className="mt-2 text-sm text-primary underline-offset-4 hover:underline"
          >
            この日の学習ノート
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
