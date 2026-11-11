import {
  accuracyPercent,
  type PrepositionRecordSummary,
} from "@/domain/practice/preposition-record";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { cn } from "@/presentation/lib/utils";

// How many rounds the trend shows.
const TREND_COUNT = 10;

// The accuracy of the latest rounds as bars, oldest on the left and the
// latest, in the accent, on the right. records come newest first.
export function AccuracyTrend({
  records,
}: {
  records: readonly Pick<
    PrepositionRecordSummary,
    "id" | "firstTryCount" | "questionCount"
  >[];
}) {
  const rounds = records.slice(0, TREND_COUNT).reverse();
  if (rounds.length < 2) return null;
  return (
    <Card className="gap-3 py-5">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="flex-1 text-sm font-semibold">正答率の推移</h2>
          <p className="text-xs text-muted-foreground">
            直近{rounds.length}回・最新が右
          </p>
        </div>
        {/* Always ten slots, the latest at the right edge, so a few
            rounds do not spread across the card. */}
        <ol
          aria-label={`直近${rounds.length}回の正答率（古い順）`}
          className="grid h-36 grid-cols-10 items-end gap-2"
        >
          {Array.from({ length: TREND_COUNT - rounds.length }, (_, i) => (
            <li key={`empty-${i}`} aria-hidden="true" />
          ))}
          {rounds.map((round, i) => {
            const value =
              accuracyPercent(round.firstTryCount, round.questionCount) ?? 0;
            return (
              <li
                key={round.id}
                className="flex h-full flex-col items-center justify-end gap-1"
              >
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {value}
                  <span className="sr-only">%</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "w-full max-w-7 rounded-t-md rounded-b-sm",
                    i === rounds.length - 1 ? "bg-primary" : "bg-primary/30",
                  )}
                  // The label above takes 1.25rem of the column.
                  style={{
                    height: `calc((100% - 1.25rem) * ${Math.max(4, value) / 100})`,
                  }}
                />
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
