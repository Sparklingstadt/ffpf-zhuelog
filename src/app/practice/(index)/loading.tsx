import { PageSkeleton } from "@/presentation/components/layout/page-skeleton";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { Skeleton } from "@/presentation/components/ui/skeleton";

// In the (index) group so it wraps only the list of practices, not the
// practice and record pages below /practice, which answer a real 404.
// The list before the last results arrive: one card per practice.
export default function Loading() {
  return (
    <PageSkeleton label="練習の一覧を読み込んでいます" width="5xl" actions={0}>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="py-5">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-7 w-40" />
                <Skeleton className="ml-auto h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-8 w-28 rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    </PageSkeleton>
  );
}
