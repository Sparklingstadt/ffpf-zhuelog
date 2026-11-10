"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import {
  isAiPath,
  mainPageOf,
  type MainPage,
} from "@/presentation/presenters/site-navigation";

// A link to a main page that says when the current path belongs to it. The
// header renders on the server, so this small client part reads the path.
export function CurrentLink({
  page,
  ...props
}: ComponentProps<typeof Link> & { page: MainPage | "ai" }) {
  const pathname = usePathname();
  const current =
    page === "ai" ? isAiPath(pathname) : mainPageOf(pathname) === page;
  return (
    <Link
      {...props}
      aria-current={current ? "page" : undefined}
      data-current={current ? "" : undefined}
    />
  );
}
