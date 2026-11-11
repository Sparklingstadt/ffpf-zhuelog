import { Languages, Sparkles } from "lucide-react";
import Link from "next/link";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { CurrentLink } from "@/presentation/components/layout/current-link";
import {
  GitHubMark,
  repositoryUrl,
} from "@/presentation/components/layout/github-mark";
import { MAIN_TAB_ICONS } from "@/presentation/components/layout/main-tab-icons";
import { SiteMenu } from "@/presentation/components/layout/site-menu";
import { ReviewCountBadge } from "@/presentation/components/review/review-count-badge";
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
function MainLinks({
  user,
  renderedAt,
}: {
  user: AuthenticatedUser;
  renderedAt?: number;
}) {
  const ai = aiHeaderLink(user.role, { demo: user.demo });
  return (
    <nav
      aria-label="主なページ"
      className="flex items-center gap-0.5 max-xl:hidden"
    >
      {mainTabs(user.role).map((tab) =>
        tab.href ? (
          <HeaderLink
            key={tab.page}
            tab={tab}
            href={tab.href}
            renderedAt={renderedAt}
          />
        ) : null,
      )}
      {ai ? (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="data-[current]:bg-primary/10 data-[current]:text-primary"
        >
          <CurrentLink href={ai.href} page="ai">
            <Sparkles />
            {ai.label}
          </CurrentLink>
        </Button>
      ) : null}
    </nav>
  );
}

function HeaderLink({
  tab,
  href,
  renderedAt,
}: {
  tab: MainTab;
  href: string;
  renderedAt?: number;
}) {
  const Icon = MAIN_TAB_ICONS[tab.page];
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="data-[current]:bg-primary/10 data-[current]:text-primary"
    >
      <CurrentLink href={href} page={tab.page}>
        <Icon />
        {tab.headerLabel}
        {tab.page === "review" ? (
          <ReviewCountBadge renderedAt={renderedAt} />
        ) : null}
      </CurrentLink>
    </Button>
  );
}

// The bar at the top of every page: the app name, the main pages and the
// menu. Without a user (sign-in) it shows the repository link and the theme
// switcher instead, which the menu holds otherwise.
export function AppHeader({
  user,
  renderedAt,
}: {
  user?: AuthenticatedUser | null;
  // When the server rendered the page, so the review count follows actions.
  renderedAt?: number;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
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
        {user ? <MainLinks user={user} renderedAt={renderedAt} /> : null}
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
