import type { ReactNode } from "react";

import { Skeleton } from "@/presentation/components/ui/skeleton";

// What a records page shows while it loads: the app header and the title row
// as gray blocks in their usual places, then `children` for the body. The
// header is drawn here because the real one needs the signed-in user.
export function PageSkeleton({
  label,
  children,
}: {
  // Read out instead of the gray blocks, e.g. "記録を読み込んでいます".
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-[49px] w-full max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="ml-auto h-7 w-40 sm:w-72" />
        </div>
      </div>
      <main className="flex-1" aria-busy="true">
        <p role="status" className="sr-only">
          {label}
        </p>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
          <div className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-3">
              <Skeleton className="h-5 w-36 rounded-full" />
              <Skeleton className="h-9 w-48" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
          {children}
        </div>
      </main>
    </>
  );
}
