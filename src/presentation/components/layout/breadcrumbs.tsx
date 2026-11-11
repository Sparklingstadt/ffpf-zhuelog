import Link from "next/link";
import { Fragment } from "react";

// Where a page sits under its section, for pages a level below a main page
// (a record under practice, a note under its day). The last item is this
// page and is not a link.
export function Breadcrumbs({
  items,
}: {
  items: readonly { label: string; href?: string }[];
}) {
  return (
    <nav aria-label="パンくず" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, i) => (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 ? (
              <li aria-hidden="true" className="select-none">
                ›
              </li>
            ) : null}
            <li>
              {item.href ? (
                <Link
                  href={item.href}
                  className="rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-foreground">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
