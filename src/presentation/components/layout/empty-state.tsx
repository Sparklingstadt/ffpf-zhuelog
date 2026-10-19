import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/presentation/components/ui/card";

// A dashed card standing in for a list with nothing to show.
export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <Card className="border-dashed py-12 text-center shadow-none">
      <CardContent>
        <Icon className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-3 font-medium">{title}</p>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
