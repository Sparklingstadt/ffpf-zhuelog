import {
  monthGrid,
  studyLevel,
  studyTotal,
  type StudyDay,
  type YearMonth,
} from "@/domain/study-log/study-log";
import { cn } from "@/presentation/lib/utils";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

// The shade of a day by how much was done, from none to a lot.
const LEVEL_CLASS = [
  "bg-muted/40",
  "bg-primary/15",
  "bg-primary/35",
  "bg-primary/60 text-primary-foreground",
  "bg-primary text-primary-foreground",
] as const;

function describe(day: StudyDay | undefined): string {
  if (!day || studyTotal(day) === 0) return "学習なし";
  const parts = [
    day.reviews ? `復習${day.reviews}回` : "",
    day.practiceQuestions ? `練習${day.practiceQuestions}問` : "",
    day.notes ? `ノート${day.notes}件` : "",
    day.words ? `単語${day.words}語` : "",
  ].filter(Boolean);
  return parts.join("・");
}

// A month as a grid of days, each shaded by how much was studied. The days of
// the next and previous months that fill its weeks are dimmed.
export function StudyCalendar({
  month,
  days,
  today,
}: {
  month: YearMonth;
  days: readonly StudyDay[];
  today: string;
}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return (
    <div
      role="grid"
      aria-label={`${month.year}年${month.month}月の学習`}
      className="grid gap-1.5"
    >
      <div role="row" className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            role="columnheader"
            className="text-center text-xs text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>
      {monthGrid(month).map((week) => (
        <div key={week[0].date} role="row" className="grid grid-cols-7 gap-1.5">
          {week.map((cell) => {
            const day = byDate.get(cell.date);
            const total = day ? studyTotal(day) : 0;
            const label = `${cell.date}：${describe(day)}`;
            return (
              <div
                key={cell.date}
                role="gridcell"
                aria-label={label}
                title={label}
                data-date={cell.date}
                data-total={total}
                className={cn(
                  "flex aspect-square min-w-0 flex-col items-center justify-center rounded-md text-xs sm:text-sm",
                  LEVEL_CLASS[studyLevel(total)],
                  !cell.inMonth && "opacity-40",
                  cell.date === today &&
                    "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                )}
              >
                <span className="font-medium">{cell.day}</span>
                {total > 0 ? (
                  <span className="font-mono text-[10px] leading-none sm:text-xs">
                    {total}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
