import Link from "next/link";

import {
  HSK_LEVEL_LABELS,
  HSK_LEVELS,
  type HskLevel,
} from "@/domain/practice/hsk-level";
import { cn } from "@/presentation/lib/utils";

// Chooses which HSK level a practice asks about, through ?hsk= on the same
// page. A level without questions cannot be chosen. On phones the levels
// stay on one row that scrolls sideways, to leave room for the question.
export function HskLevelPicker({
  path,
  current,
  counts,
  total,
}: {
  path: string;
  current: HskLevel | null;
  counts: Record<HskLevel, number>;
  total: number;
}) {
  const options: { level: HskLevel | null; label: string; count: number }[] = [
    { level: null, label: "すべて", count: total },
    ...HSK_LEVELS.map((level) => ({
      level,
      label: HSK_LEVEL_LABELS[level],
      count: counts[level],
    })),
  ];
  return (
    <nav
      aria-label="HSK の級"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      {options.map(({ level, label, count }) => {
        const selected = level === current;
        const className = cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-card hover:bg-accent",
          count === 0 && "pointer-events-none opacity-50",
        );
        const body = (
          <>
            {label}
            <span
              className={cn(
                "text-xs tabular-nums",
                selected ? "opacity-80" : "text-muted-foreground",
              )}
            >
              {count}問
            </span>
          </>
        );
        return count === 0 ? (
          <span key={label} className={className} aria-disabled="true">
            {body}
          </span>
        ) : (
          <Link
            key={label}
            href={level === null ? path : `${path}?hsk=${level}`}
            aria-current={selected ? "page" : undefined}
            className={className}
          >
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
