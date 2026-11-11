import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import type { LogDate } from "@/domain/calendar/value-objects/log-date";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { cn } from "@/presentation/lib/utils";
import {
  monthCells,
  type CalendarMonth,
} from "@/presentation/presenters/note-calendar-presenter";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"] as const;

// A month of learning notes: the days with notes are links, marked with a
// dot, and the day being shown is filled. The arrows move a month.
export function NoteCalendar({
  month,
  counts,
  selected,
  dayHref,
  monthHref,
}: {
  month: CalendarMonth;
  counts: readonly { date: LogDate; count: number }[];
  selected?: LogDate | null;
  dayHref: (date: LogDate) => string;
  monthHref: (by: -1 | 1) => string;
}) {
  const cells = monthCells(month, counts);
  const total = cells.reduce(
    (sum, cell) => sum + (cell.kind === "day" ? cell.count : 0),
    0,
  );
  return (
    <Card className="gap-3 py-5">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon">
            <Link href={monthHref(-1)} aria-label="前の月">
              <ChevronLeft />
            </Link>
          </Button>
          <h2 className="flex-1 text-center text-base font-semibold">
            {month.year}年{month.month}月
          </h2>
          <Button asChild variant="outline" size="icon">
            <Link href={monthHref(1)} aria-label="次の月">
              <ChevronRight />
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w) => (
            <span
              key={w}
              aria-hidden="true"
              className="text-xs text-muted-foreground"
            >
              {w}
            </span>
          ))}
          {cells.map((cell, i) => {
            if (cell.kind === "blank")
              return <span key={i} aria-hidden="true" />;
            const here =
              selected?.year === cell.date.year &&
              selected.month === cell.date.month &&
              selected.day === cell.date.day;
            const body = (
              <>
                {cell.date.day}
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    cell.count === 0
                      ? "bg-transparent"
                      : here
                        ? "bg-primary-foreground"
                        : "bg-primary",
                  )}
                />
              </>
            );
            const base =
              "flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-sm tabular-nums";
            return cell.count === 0 ? (
              <span key={i} className={cn(base, "text-muted-foreground/60")}>
                {body}
              </span>
            ) : (
              <Link
                key={i}
                href={dayHref(cell.date)}
                aria-label={`${cell.date.month}月${cell.date.day}日 ${cell.count}件`}
                aria-current={here ? "date" : undefined}
                className={cn(
                  base,
                  "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  here
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "font-medium hover:bg-muted",
                )}
              >
                {body}
              </Link>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          点のある日に学習ノートがあります。この月 {total}件
        </p>
      </CardContent>
    </Card>
  );
}
