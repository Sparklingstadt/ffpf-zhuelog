import { PageSkeleton } from "@/presentation/components/layout/page-skeleton";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { Skeleton } from "@/presentation/components/ui/skeleton";

// One record before Go answers: the three stats and the list of questions.
export default function Loading() {
  return (
    <PageSkeleton label="練習の記録を読み込んでいます">
      <Card>
        <CardContent className="flex flex-col items-center gap-6">
          <div className="grid w-full max-w-md grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[70px] rounded-lg" />
            ))}
          </div>
          <div className="w-full space-y-2">
            <Skeleton className="h-4 w-36" />
            <div className="divide-y rounded-lg border">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="ml-auto h-4 w-12" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </PageSkeleton>
  );
}
