import { PageSkeleton } from "@/presentation/components/layout/page-skeleton";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { Skeleton } from "@/presentation/components/ui/skeleton";

// Today's review before the queue arrives: the progress line and one card
// with its answer button. The page has no 404 of its own (it only
// redirects), so the skeleton's 200 hides no status.
export default function Loading() {
  return (
    <PageSkeleton label="復習を読み込んでいます" width="4xl" actions={1}>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Card className="py-10 sm:py-14">
        <CardContent className="flex flex-col items-center gap-8">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-64 max-w-full" />
          <Skeleton className="h-10 w-40 rounded-lg" />
        </CardContent>
      </Card>
    </PageSkeleton>
  );
}
