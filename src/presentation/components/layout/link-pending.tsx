"use client";

import { useLinkStatus } from "next/link";

import { cn } from "@/presentation/lib/utils";

// A thin bar inside a <Link> that shows while its page is on the way: every
// page is rendered on demand, so the answer can take a moment and the press
// would otherwise show nothing. Always rendered at a fixed size (no layout
// shift) and only faded in; the short delay keeps it from flashing on a fast
// navigation. The link needs `relative`; pair it with
// `has-data-pending:…` on the link to restyle the link itself.
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-pending={pending ? "" : undefined}
      className={cn(
        "pointer-events-none absolute h-0.5 rounded-full bg-primary opacity-0 transition-opacity data-pending:animate-pulse data-pending:opacity-100 data-pending:delay-100",
        className,
      )}
    />
  );
}
