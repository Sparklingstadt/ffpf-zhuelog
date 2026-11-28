import type { ReactNode } from "react";

import { Skeleton } from "@/presentation/components/ui/skeleton";
import { cn } from "@/presentation/lib/utils";

// The same columns as PageShell's.
const widths = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

// What a records page shows while it loads: the app header and the title row
// as gray blocks in their usual places, then `children` for the body. The
// header is drawn here because the real one needs the signed-in user.
export function PageSkeleton({
  label,
  width = "4xl",
  titleRow = true,
  actions = 2,
  spacious = false,
  children,
}: {
  // Read out instead of the gray blocks, e.g. "記録を読み込んでいます".
  label: string;
  // The page's PageShell width.
  width?: keyof typeof widths;
  // false for a page without a PageHeader (the home).
  titleRow?: boolean;
  // How many buttons the title row has on the right.
  actions?: number;
  // A wider gap between sections, as PageShell's spacious.
  spacious?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <div className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="ml-auto h-7 w-40 sm:w-72" />
        </div>
      </div>
      <main className="flex-1" aria-busy="true">
        <p role="status" className="sr-only">
          {label}
        </p>
        <div
          className={cn(
            "mx-auto flex w-full flex-col px-4 py-8 sm:px-6 sm:py-12 lg:px-8",
            widths[width],
            spacious ? "gap-8" : "gap-6",
          )}
        >
          {titleRow ? (
            <div className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-3">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
              {actions > 0 ? (
                <div className="flex gap-2">
                  {Array.from({ length: actions }, (_, i) => (
                    <Skeleton key={i} className="h-8 w-24" />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </>
  );
}
