import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/presentation/components/ui/badge";

type Props = {
  icon: LucideIcon;
  // Short English label in the badge above the title.
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  // Links and buttons on the right: back links, the trash, sign-out.
  actions: ReactNode;
};

// The title row of a records page.
export function PageHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
}: Props) {
  return (
    <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-3">
        <Badge variant="secondary" className="gap-1.5">
          <Icon className="size-3.5" /> {eyebrow}
        </Badge>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}
