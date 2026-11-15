import Link from "next/link";

import { cn } from "@/presentation/lib/utils";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

// The saved questions or conversations in the AI pages' left column, the
// one on screen marked.
export function AiRecentList({
  items,
  currentId,
  empty,
  allHref,
  allLabel,
}: {
  items: readonly { id: string; label: string; href: string; at: Date }[];
  currentId?: string;
  empty: string;
  allHref: string;
  allLabel: string;
}) {
  return (
    <>
      {items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={item.id === currentId ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                  item.id === currentId && "bg-primary/10 font-semibold",
                )}
              >
                <span className="line-clamp-2 break-words">{item.label}</span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {formatTokyoDateTime(item.at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 text-sm text-muted-foreground">{empty}</p>
      )}
      <Link href={allHref} className="block px-3 text-sm">
        {allLabel}
      </Link>
    </>
  );
}
