import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/presentation/lib/utils";

// The left column of the AI pages on wide screens: the two ways to ask
// (quick questions and the chat) as tabs, then that way's saved notes. The
// demo account, which Go refuses the AI, gets no tabs.
export function AiSideNav({
  current,
  showTabs,
  action,
  title,
  children,
}: {
  current: "quick" | "chat";
  showTabs: boolean;
  // The way to start anew, under the tabs.
  action?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const tab = (href: string, label: string, here: boolean) => (
    <Link
      href={href}
      aria-current={here ? "page" : undefined}
      className={cn(
        "flex h-9 flex-1 items-center justify-center rounded-md text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        here
          ? "bg-background font-semibold shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
  return (
    <aside aria-label="AI に聞く" className="space-y-3 max-lg:hidden">
      {showTabs ? (
        <nav aria-label="聞き方" className="flex gap-1 rounded-lg bg-muted p-1">
          {tab("/quick-question", "クイック質問", current === "quick")}
          {tab("/chat", "ChatGPT と話す", current === "chat")}
        </nav>
      ) : null}
      {action}
      <h2 className="pt-2 text-xs font-semibold text-muted-foreground">
        {title}
      </h2>
      {children}
    </aside>
  );
}
