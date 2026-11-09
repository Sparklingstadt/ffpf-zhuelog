import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/presentation/components/ui/badge";
import { cn } from "@/presentation/lib/utils";

type Props = {
  icon: LucideIcon;
  // Short English label in the badge above the title.
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  // Links and buttons for this page on the right: back links, the trash.
  actions: ReactNode;
  // A smaller title and description on phones, without the badge, for the
  // practice pages (see PageShell's dense).
  dense?: boolean;
};

// The title row of a records page.
export function PageHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
  dense = false,
}: Props) {
  return (
    <header
      className={cn(
        "flex flex-col border-b sm:flex-row sm:items-end sm:justify-between sm:gap-5 sm:pb-6",
        dense ? "gap-3 pb-4" : "gap-5 pb-6",
      )}
    >
      <div className="space-y-3">
        <Badge
          variant="secondary"
          className={cn("gap-1.5", dense && "max-sm:hidden")}
        >
          <Icon className="size-3.5" /> {eyebrow}
        </Badge>
        <div>
          <h1
            className={cn(
              "font-semibold tracking-tight sm:text-3xl",
              dense ? "text-2xl" : "text-3xl",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={cn(
                "text-muted-foreground sm:mt-2 sm:text-sm",
                dense ? "mt-1 text-xs leading-relaxed" : "mt-2 text-sm",
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
