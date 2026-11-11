import { ChevronRight } from "lucide-react";
import Link from "next/link";

import {
  accuracyPercent,
  formatElapsed,
  type PrepositionRecordSummary,
} from "@/domain/practice/preposition-record";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

// The rounds of a practice as one table-like list, newest first: when, what
// (「25問」, or 「了・过・着 · 25問」), then the accuracy, misses and time in
// columns, each row opening the round.
export function RecordList<R extends PrepositionRecordSummary>({
  records,
  hrefOf,
  labelOf,
}: {
  records: readonly R[];
  hrefOf: (id: string) => string;
  labelOf: (record: R) => string;
}) {
  return (
    <section
      aria-labelledby="records-heading"
      className="overflow-hidden rounded-xl border bg-card"
    >
      <h2 id="records-heading" className="px-4 py-3 text-sm font-semibold">
        すべての記録{" "}
        <span className="font-normal text-muted-foreground">
          {records.length}回
        </span>
      </h2>
      <div
        aria-hidden="true"
        className="grid grid-cols-[minmax(0,1fr)_4rem_3.5rem_3.5rem_1rem] gap-2 bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground"
      >
        <span>日時</span>
        <span className="text-right">正答率</span>
        <span className="text-right">ミス</span>
        <span className="text-right">時間</span>
      </div>
      <ul>
        {records.map((record) => (
          <li key={record.id} className="border-t">
            <Link
              href={hrefOf(record.id)}
              className="group grid grid-cols-[minmax(0,1fr)_4rem_3.5rem_3.5rem_1rem] items-center gap-2 px-4 py-3 text-sm outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <span className="min-w-0">
                <span className="block font-medium tabular-nums">
                  {formatTokyoDateTime(record.createdAt)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {labelOf(record)}
                </span>
              </span>
              <span className="text-right font-semibold tabular-nums">
                <span className="sr-only">正答率</span>
                {accuracyPercent(record.firstTryCount, record.questionCount) ??
                  0}
                %
              </span>
              <span className="text-right text-muted-foreground tabular-nums">
                <span className="sr-only">ミス</span>
                {record.missCount}回
              </span>
              <span className="text-right text-muted-foreground tabular-nums">
                <span className="sr-only">時間</span>
                {formatElapsed(record.elapsedMs)}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
