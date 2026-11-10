import { History, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/presentation/components/ui/button";

// The bar over a practice round, in place of a page header: a way out, the
// practice's name, the HSK levels and the past records, on one row where
// the screen is wide enough. The explanation of the practice shows only on
// wide and tall screens, to leave the room for the question.
export function PracticeBar({
  title,
  description,
  exitHref,
  recordsHref,
  levels,
}: {
  title: string;
  description: string;
  // Where "stop practicing" goes: the list of practices or of modes.
  exitHref: string;
  // Only members and admins have records.
  recordsHref: string | null;
  levels: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2 border-b pb-3 roomy:gap-3 roomy:pb-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 size-11 shrink-0"
          >
            <Link href={exitHref} aria-label="練習をやめる">
              <X />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold tracking-tight roomy:text-2xl">
            {title}
          </h1>
        </div>
        <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
          {levels}
        </div>
        {recordsHref ? (
          <Button asChild variant="outline" size="sm" className="ml-auto">
            <Link href={recordsHref}>
              <History /> 過去の記録
            </Link>
          </Button>
        ) : null}
      </div>
      <p className="hidden text-sm text-muted-foreground roomy:block">
        {description}
      </p>
    </header>
  );
}
