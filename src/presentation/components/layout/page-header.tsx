import type { ReactNode } from "react";

import { cn } from "@/presentation/lib/utils";

type Props = {
  title: ReactNode;
  description?: ReactNode;
  // Links and buttons for this page on the right: back links, the trash.
  actions: ReactNode;
  // A smaller title and description unless the screen is wide and tall
  // (`roomy`), for the practice pages (see PageShell's dense).
  dense?: boolean;
};

// The title row of a page: no label above it, since the header already
// names the app and the current page.
export function PageHeader({
  title,
  description,
  actions,
  dense = false,
}: Props) {
  return (
    <header
      className={cn(
        "flex flex-col border-b sm:flex-row sm:items-end sm:justify-between",
        dense ? "gap-3 pb-4 roomy:gap-5 roomy:pb-6" : "gap-5 pb-6",
      )}
    >
      <div className="space-y-3">
        <div>
          <h1
            className={cn(
              "font-semibold tracking-tight",
              dense ? "text-2xl roomy:text-3xl" : "text-3xl",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={cn(
                "text-muted-foreground",
                dense
                  ? "mt-1 text-xs leading-relaxed roomy:mt-2 roomy:text-sm"
                  : "mt-2 text-sm",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}
