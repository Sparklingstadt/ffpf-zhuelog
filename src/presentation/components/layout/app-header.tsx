import { Languages, Sparkles } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { CurrentLink } from "@/presentation/components/layout/current-link";
import { LinkPending } from "@/presentation/components/layout/link-pending";
import {
  GitHubMark,
  repositoryUrl,
} from "@/presentation/components/layout/github-mark";
import { MAIN_TAB_ICONS } from "@/presentation/components/layout/main-tab-icons";
import { SiteMenu } from "@/presentation/components/layout/site-menu";
import {
  ReviewCountBadge,
  ReviewCountSource,
} from "@/presentation/components/review/review-count-badge";
import { ThemeSwitcher } from "@/presentation/components/theme/theme-switcher";
import { Button } from "@/presentation/components/ui/button";
import {
  aiHeaderLink,
  mainTabs,
  menuIdentity,
  type MainTab,
} from "@/presentation/presenters/site-navigation";

// The four main pages and the AI questions, with text, on screens wide enough to have no bottom
// tabs (xl); below that the tabs carry them and the header stays one row.
function MainLinks({ user }: { user: AuthenticatedUser }) {
  const ai = aiHeaderLink(user.role, { demo: user.demo });
  return (
    <nav
      aria-label="主なページ"
      className="flex items-center gap-0.5 max-xl:hidden"
    >
      {mainTabs(user.role).map((tab) =>
        tab.href ? (
          <HeaderLink key={tab.page} tab={tab} href={tab.href} />
        ) : null,
      )}
      {ai ? (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="relative data-[current]:bg-primary/10 data-[current]:text-primary has-data-pending:bg-primary/10 has-data-pending:text-primary"
        >
          <CurrentLink href={ai.href} page="ai">
            <Sparkles />
            {ai.label}
            <LinkPending className="inset-x-2 bottom-0" />
          </CurrentLink>
        </Button>
      ) : null}
    </nav>
  );
}

function HeaderLink({ tab, href }: { tab: MainTab; href: string }) {
  const Icon = MAIN_TAB_ICONS[tab.page];
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="relative data-[current]:bg-primary/10 data-[current]:text-primary has-data-pending:bg-primary/10 has-data-pending:text-primary"
    >
      <CurrentLink href={href} page={tab.page}>
        <Icon />
        {tab.headerLabel}
        {tab.page === "review" ? <ReviewCountBadge /> : null}
        <LinkPending className="inset-x-2 bottom-0" />
      </CurrentLink>
    </Button>
  );
}

// The bar at the top of every page: the app name, the main pages and the
// menu. Without a user (sign-in) it shows the repository link and the theme
// switcher instead, which the menu holds otherwise.
// With `reviewCount` it also hands that count to the badges here and on the
// bottom tabs: every signed-in page renders this header, so the count follows
// each navigation and each render after an action. The promise is awaited in
// the browser part under a Suspense, so the page is sent without waiting for
// it. This file is also used by the error pages (client components), so the
// read itself is started by the caller (signedInHeaderProps).
export function AppHeader({
  user,
  reviewCount,
}: {
  user?: AuthenticatedUser | null;
  // How many reviews are due; never rejects.
  reviewCount?: Promise<number | null>;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      {reviewCount ? (
        <Suspense fallback={null}>
          <ReviewCountSource count={reviewCount} />
        </Suspense>
      ) : null}
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-x-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Languages className="size-4" />
          </span>
          学习録
        </Link>
        {user ? <MainLinks user={user} /> : null}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {user ? (
            <SiteMenu
              variant="header"
              role={user.role}
              demo={user.demo}
              {...menuIdentity(user)}
            />
          ) : (
            // Signed in, the repository and the theme are in the menu.
            <>
              <Button asChild variant="ghost" size="icon-sm" title="GitHub">
                <a
                  href={repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GitHubMark />
                  <span className="sr-only">
                    GitHub のリポジトリ（新しいタブ）
                  </span>
                </a>
              </Button>
              <ThemeSwitcher />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
