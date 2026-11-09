"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AppRole } from "@/domain/identity/entities/authenticated-user";
import { MAIN_TAB_ICONS } from "@/presentation/components/layout/main-tab-icons";
import { SiteMenu } from "@/presentation/components/layout/site-menu";
import {
  mainPageOf,
  mainTabs,
} from "@/presentation/presenters/site-navigation";
import { cn } from "@/presentation/lib/utils";

const tabBase =
  "my-1 flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-[11px] leading-tight font-medium whitespace-normal sm:text-sm";
const tabInteractive =
  "outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50";

// The tabs at the bottom of phones and tablets: the four main pages and the
// menu with everything else. Wide screens (xl) have them in the header.
export function BottomNavigation({
  role,
  name,
  roleLabel,
}: {
  role: AppRole;
  name: string;
  roleLabel: string;
}) {
  const current = mainPageOf(usePathname());

  return (
    <nav
      aria-label="メインメニュー"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-md xl:hidden"
    >
      <div className="mx-auto grid h-20 w-full max-w-6xl grid-cols-5 px-2">
        {mainTabs(role).map((tab) => {
          const Icon = MAIN_TAB_ICONS[tab.page];
          const active = current === tab.page;
          const content = (
            <>
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="max-w-full">{tab.label}</span>
            </>
          );
          return tab.href ? (
            <Link
              key={tab.page}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                tabBase,
                tabInteractive,
                active ? "bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              {content}
            </Link>
          ) : (
            <button
              key={tab.page}
              type="button"
              disabled
              className={cn(
                tabBase,
                "cursor-not-allowed text-muted-foreground",
              )}
              title={`${tab.label}（${tab.unavailable}）`}
              aria-label={`${tab.label}（${tab.unavailable}）`}
            >
              {content}
              <span className="max-w-full text-[9px] leading-tight sm:text-[10px]">
                {tab.unavailable}
              </span>
            </button>
          );
        })}
        <SiteMenu
          variant="tab"
          role={role}
          name={name}
          roleLabel={roleLabel}
          tabClassName={cn(
            tabBase,
            tabInteractive,
            "text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
          )}
        />
      </div>
    </nav>
  );
}
