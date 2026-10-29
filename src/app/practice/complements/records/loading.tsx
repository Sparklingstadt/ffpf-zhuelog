import { PageSkeleton } from "@/presentation/components/layout/page-skeleton";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { Skeleton } from "@/presentation/components/ui/skeleton";

// The record list before Go answers: a few rows with a date and three stats.
export default function Loading() {
  return (
    <PageSkeleton label="練習の記録を読み込んでいます">
      <div className="grid gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-10" />
              </div>
              <div className="flex gap-4 sm:gap-6">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="flex flex-col items-end gap-1.5">
                    <Skeleton className="h-3 w-8" />
                    <Skeleton className="h-4 w-10" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageSkeleton>
  );
}
