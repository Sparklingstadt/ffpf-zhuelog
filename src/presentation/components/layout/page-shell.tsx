import type { ReactNode } from "react";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { AppHeader } from "@/presentation/components/layout/app-header";
import { cn } from "@/presentation/lib/utils";

const widths = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

// The app header and the centered column every records page sits in.
export function PageShell({
  user,
  width,
  spacious = false,
  children,
}: {
  user: AuthenticatedUser;
  width: keyof typeof widths;
  // A wider gap between sections, for the home page.
  spacious?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <AppHeader user={user} />
      <main className="flex-1">
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
    </>
  );
}
