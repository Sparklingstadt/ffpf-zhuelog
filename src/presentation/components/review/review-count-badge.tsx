"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { cn } from "@/presentation/lib/utils";

// How many reviews are due, shared by the header and the bottom tabs. It is
// read again on every page and whenever the server renders the page again
// (an action such as putting a note in review), so it follows the queue.
// null until read, for guests, and when the count cannot be read.
let count: number | null = null;
let readFor: string | null = null;
let reading = false;
let again = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function fetchCount(): Promise<number | null> {
  try {
    const response = await fetch("/api/review-count", { cache: "no-store" });
    const json = (await response.json()) as { count: unknown };
    return typeof json.count === "number" ? json.count : null;
  } catch {
    return null;
  }
}

// The header and the tabs ask at once for the same render; asks that come
// while a read is under way are served by one more read after it, so the
// last answer is never older than the last ask.
async function read(key: string) {
  if (readFor === key) return;
  readFor = key;
  if (reading) {
    again = true;
    return;
  }
  reading = true;
  do {
    again = false;
    count = await fetchCount();
  } while (again);
  reading = false;
  listeners.forEach((listener) => listener());
}

// The number on the review tab: nothing when no review is due. Screen
// readers hear 「（29問）」 after the tab's name.
export function ReviewCountBadge({
  className,
  renderedAt = 0,
}: {
  className?: string;
  // When the server rendered the page: a new render reads the count again.
  renderedAt?: number;
}) {
  const path = usePathname();
  const due = useSyncExternalStore(
    subscribe,
    () => count,
    () => null,
  );
  useEffect(() => {
    void read(`${path}|${renderedAt}`);
  }, [path, renderedAt]);
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
