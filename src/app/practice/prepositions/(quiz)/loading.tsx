import { PageSkeleton } from "@/presentation/components/layout/page-skeleton";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { Skeleton } from "@/presentation/components/ui/skeleton";

// In the (quiz) group so it does not wrap the record pages, which check the
// role in their layout before any skeleton streams.
// The practice page before its quiz arrives: the progress bar, the three
// stats and a question card with four choices.
export default function Loading() {
  return (
    <PageSkeleton label="練習を読み込んでいます">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-2.5 w-full rounded-full" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[62px] rounded-lg" />
          ))}
        </div>
        <Card className="py-10 sm:py-14">
          <CardContent className="flex flex-col items-center gap-10">
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-56 sm:h-[72px]" />
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="grid w-full max-w-md grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageSkeleton>
  );
}
