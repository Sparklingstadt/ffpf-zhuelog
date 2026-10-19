import type { ReactNode } from "react";

import { cn } from "@/presentation/lib/utils";

const widths = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

// The centered column every records page sits in.
export function PageShell({
  width,
  spacious = false,
  children,
}: {
  width: keyof typeof widths;
  // A wider gap between sections, for the home page.
  spacious?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background">
      <div
        className={cn(
          "mx-auto flex w-full flex-col px-4 py-8 sm:px-6 sm:py-12 lg:px-8",
          widths[width],
          spacious ? "gap-8" : "gap-6",
        )}
      >
        {children}
      </div>
    </main>
  );
}
