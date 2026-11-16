"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Linking happens in LINE, outside this page, so the page renders itself
// again to see the link: whenever it comes back into view, and every 5
// seconds while a link code is valid (`expiresAt`). It stops once the
// refreshed server props report the link (`linked`).
export function useRefreshUntilLinked({
  linked,
  expiresAt,
}: {
  linked: boolean;
  expiresAt?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (linked) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = expiresAt ? window.setInterval(refresh, 5000) : undefined;
    const expiryTimer = expiresAt
      ? window.setTimeout(
          () => window.clearInterval(interval),
          Math.max(0, Date.parse(expiresAt) - Date.now()),
        )
      : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
      window.clearTimeout(expiryTimer);
    };
  }, [linked, expiresAt, router]);
}
