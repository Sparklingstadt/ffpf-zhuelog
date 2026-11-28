import { PageSkeleton } from "@/presentation/components/layout/page-skeleton";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { Skeleton } from "@/presentation/components/ui/skeleton";

// The vocabulary before the database answers: the add form's card and a few
// rows of words. The page has no 404 of its own (it only redirects), so the
// skeleton's 200 hides no status.
export default function Loading() {
  return (
    <PageSkeleton label="単語帳を読み込んでいます" width="6xl" actions={0}>
      <Card>
        <CardContent className="space-y-4">
          <Skeleton className="h-5 w-28" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-10 flex-1 rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg sm:w-28" />
          </div>
        </CardContent>
      </Card>
      <div className="divide-y rounded-lg border">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-4 w-24 max-sm:hidden" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
