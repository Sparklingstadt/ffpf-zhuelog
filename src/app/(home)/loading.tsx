import { PageSkeleton } from "@/presentation/components/layout/page-skeleton";
import { Skeleton } from "@/presentation/components/ui/skeleton";

// In the (home) group so it wraps only the home: a loading file directly
// under src/app would wrap every page, and a streamed skeleton fixes the
// status at 200, so their 404s would no longer be real.
// The home before the database answers: the review card, the heading, the
// search row and a few closed note cards.
export default function Loading() {
  return (
    <PageSkeleton
      label="学習ノートを読み込んでいます"
      width="6xl"
      titleRow={false}
      spacious
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl max-md:hidden" />
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-11 rounded-lg" />
        <div className="grid gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border bg-card px-5 py-4 shadow-xs sm:px-6"
            >
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-5 flex-1" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
