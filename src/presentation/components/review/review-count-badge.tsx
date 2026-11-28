"use client";

import { use, useEffect, useSyncExternalStore } from "react";

import { cn } from "@/presentation/lib/utils";

// How many reviews are due, shared by the header and the bottom tabs. Every
// page's header brings the count with it (ReviewCountSource), so it follows
// each navigation and each render after an action (such as putting a note in
// review) without a request of its own. null until the first page says,
// for guests, and when the count cannot be read.
let count: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Takes the count the server read while rendering the page and gives it to
// every badge. Renders nothing; it sits in the header under a Suspense, so
// the page does not wait for the count.
export function ReviewCountSource({
  count: read,
}: {
  // Never rejects (loadReviewCount).
  count: Promise<number | null>;
}) {
  const value = use(read);
  useEffect(() => {
    count = value;
    listeners.forEach((listener) => listener());
  }, [value, read]);
  return null;
}

// The number on the review tab: nothing when no review is due. Screen
// readers hear 「（29問）」 after the tab's name.
export function ReviewCountBadge({ className }: { className?: string }) {
  const due = useSyncExternalStore(
    subscribe,
    () => count,
    () => null,
  );
  if (!due) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums",
          className,
        )}
      >
        {due > 99 ? "99+" : due}
      </span>
      <span className="sr-only">（{due}問）</span>
    </>
  );
}
