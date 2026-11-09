"use client";

import { ChevronDown, CircleUserRound, LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { DropdownMenu } from "radix-ui";

import type { AppRole } from "@/domain/identity/entities/authenticated-user";
import { signOutAction } from "@/presentation/actions/auth-actions";
import {
  isCurrentLink,
  menuSections,
} from "@/presentation/presenters/site-navigation";
import { cn } from "@/presentation/lib/utils";

// The menu with every page that is not a main tab, the signed-in person and
// the sign-out. The header's trigger shows who is signed in at every width
// ("header"); phones and tablets can also open it from the last bottom tab
// ("tab"), within reach of the thumb.
export function SiteMenu({
  role,
  demo = false,
  name,
  roleLabel,
  variant,
  tabClassName,
}: {
  role: AppRole;
  // The demo account, whose menu leaves out what Go refuses it.
  demo?: boolean;
  name: string;
  roleLabel: string;
  variant: "header" | "tab";
  // The bottom tab's look, shared with the other tabs.
  tabClassName?: string;
}) {
  const pathname = usePathname();
  // The sign-out form stays outside the menu, which unmounts as soon as an
  // item is chosen: a submit button inside it would be gone before the
  // browser submitted, so the item submits this form itself.
  const signOutForm = useRef<HTMLFormElement>(null);
  const sections = menuSections(role, { demo });

  return (
    <>
      <form ref={signOutForm} action={signOutAction} hidden />
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          {variant === "header" ? (
            <button
              type="button"
              className="inline-flex h-8 max-w-56 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-accent"
            >
              <CircleUserRound
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate">{name}</span>
              {role === "guest" ? null : (
                // Hidden on phones to leave room for the name.
                <span className="shrink-0 rounded bg-secondary px-1.5 text-xs font-normal text-secondary-foreground max-sm:hidden">
                  {roleLabel}
                </span>
              )}
              <span className="sr-only">のメニュー</span>
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          ) : (
            <button type="button" className={tabClassName}>
              <Menu className="size-5 shrink-0" aria-hidden="true" />
              <span className="max-w-full">メニュー</span>
            </button>
          )}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side={variant === "header" ? "bottom" : "top"}
            align="end"
            sideOffset={6}
            collisionPadding={12}
            aria-label="メニュー"
            className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            <div className="flex items-center gap-2 px-2 py-2 text-sm">
              <CircleUserRound
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 truncate font-medium">{name}</span>
              <span className="ml-auto shrink-0 rounded bg-secondary px-1.5 text-xs text-secondary-foreground">
                {roleLabel}
              </span>
            </div>
            {sections.map((section) => (
              <DropdownMenu.Group key={section.title} className="pt-1">
                <DropdownMenu.Separator className="mx-1 mb-1 h-px bg-border" />
                <DropdownMenu.Label className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
                  {section.title}
                </DropdownMenu.Label>
                {section.links.map((link) => {
                  const current = isCurrentLink(pathname, link.href);
                  return (
                    <DropdownMenu.Item key={link.href} asChild>
                      <Link
                        href={link.href}
                        aria-current={current ? "page" : undefined}
                        className={cn(
                          "flex rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                          current && "font-medium text-primary",
                        )}
                      >
                        {link.label}
                      </Link>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Group>
            ))}
            <DropdownMenu.Separator className="mx-1 my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={() => signOutForm.current?.requestSubmit()}
              className="flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <LogOut className="size-4" aria-hidden="true" />
              ログアウト
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
