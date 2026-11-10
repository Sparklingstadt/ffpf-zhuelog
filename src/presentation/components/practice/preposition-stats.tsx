import { formatElapsed } from "@/domain/practice/preposition-record";

// The accuracy, the misses and the time of a round, during it and after.
// accuracy is null before the first answer. During the round ("sm") they
// are one line beside the progress bar; the result shows them as tiles.
export function PrepositionStats({
  accuracy,
  missCount,
  elapsedMs,
  size = "sm",
}: {
  accuracy: number | null;
  missCount: number;
  elapsedMs: number;
  size?: "sm" | "lg";
}) {
  const stats = [
    { label: "正答率", value: accuracy === null ? "—" : `${accuracy}%` },
    { label: "ミス", value: `${missCount}回` },
    { label: "経過時間", value: formatElapsed(elapsedMs) },
  ];
  // During the round the stats are one quiet line beside the progress bar.
  if (size === "sm")
    return (
      <dl className="flex shrink-0 items-baseline gap-x-3 text-sm text-muted-foreground">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-baseline gap-1">
            <dt className="text-xs whitespace-nowrap">{stat.label}</dt>
            <dd className="font-mono font-semibold text-foreground tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <dl className="grid w-full max-w-md grid-cols-3 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col items-center gap-0.5 rounded-lg border bg-card px-2 py-2"
        >
          <dt className="text-xs whitespace-nowrap text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="font-mono text-2xl font-semibold tabular-nums">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
