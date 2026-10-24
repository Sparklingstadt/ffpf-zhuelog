import { formatElapsed } from "@/domain/practice/preposition-record";
import { cn } from "@/presentation/lib/utils";

// The accuracy, the misses and the time of a round, during it and after.
// accuracy is null before the first answer.
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
  return (
    <dl
      className={cn(
        "grid w-full grid-cols-3 gap-3",
        size === "lg" && "max-w-md",
      )}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col items-center gap-0.5 rounded-lg border bg-card px-2 py-2"
        >
          <dt className="text-xs text-muted-foreground">{stat.label}</dt>
          <dd
            className={cn(
              "font-mono font-semibold tabular-nums",
              size === "lg" ? "text-2xl" : "text-lg",
            )}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
