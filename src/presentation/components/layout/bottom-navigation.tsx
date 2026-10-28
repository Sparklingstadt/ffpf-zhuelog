"use client";

import {
  BookOpen,
  CircleHelp,
  MessageCircle,
  MessagesSquare,
  Shuffle,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  isMemberRole,
  type AppRole,
} from "@/domain/identity/entities/authenticated-user";
import { cn } from "@/presentation/lib/utils";

export function BottomNavigation({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const tabs = [
    {
      label: "学習ノート",
      href: "/",
      icon: BookOpen,
      active:
        pathname === "/" ||
        pathname.startsWith("/logs") ||
        pathname === "/import" ||
        pathname === "/export",
    },
    {
      label: "介詞練習",
      href: "/practice/prepositions",
      icon: Shuffle,
      active: pathname.startsWith("/practice/prepositions"),
    },
    {
      label: "LINE連携",
      href: isMemberRole(role) ? "/account/line" : undefined,
      icon: MessageCircle,
      active: pathname.startsWith("/account/line"),
      unavailable: "メンバー向け",
    },
    {
      label: "クイック質問",
      href: isMemberRole(role) ? "/quick-question" : undefined,
      icon: CircleHelp,
      active:
        pathname === "/quick-question" || pathname.startsWith("/questions"),
      unavailable: "メンバー向け",
    },
    {
      label: "会話ノート",
      href: isMemberRole(role) ? "/conversations" : undefined,
      icon: MessagesSquare,
      active: pathname.startsWith("/conversations"),
      unavailable: "メンバー向け",
    },
  ];

  return (
    <nav
      aria-label="メインメニュー"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-md xl:hidden"
    >
      <div className="mx-auto grid h-20 w-full max-w-6xl grid-cols-5 px-2">
        {tabs.map(({ label, href, icon: Icon, active, unavailable }) => {
          const className = cn(
            "my-1 flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-[11px] leading-tight font-medium whitespace-normal sm:text-sm",
            href
              ? "outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
              : "cursor-not-allowed text-muted-foreground",
            href &&
              (active ? "bg-primary/10 text-primary" : "text-muted-foreground"),
          );
          const content = (
            <>
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="max-w-full">{label}</span>
            </>
          );

          return href ? (
            <Link
              key={label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={className}
            >
              {content}
            </Link>
          ) : (
            <button
              key={label}
              type="button"
              disabled
              className={className}
              title={`${label}（${unavailable}）`}
              aria-label={`${label}（${unavailable}）`}
            >
              {content}
              <span className="max-w-full text-[9px] leading-tight sm:text-[10px]">
                {unavailable}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
