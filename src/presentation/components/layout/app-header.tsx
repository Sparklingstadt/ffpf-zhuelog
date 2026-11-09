import { Languages } from "lucide-react";
import Link from "next/link";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { CurrentLink } from "@/presentation/components/layout/current-link";
import { MAIN_TAB_ICONS } from "@/presentation/components/layout/main-tab-icons";
import { SiteMenu } from "@/presentation/components/layout/site-menu";
import { ThemeSwitcher } from "@/presentation/components/theme/theme-switcher";
import { Button } from "@/presentation/components/ui/button";
import {
  mainTabs,
  menuIdentity,
  type MainTab,
} from "@/presentation/presenters/site-navigation";

const repositoryUrl = "https://github.com/Sparklingstadt/ffpf-zhuelog";

// The GitHub mark. lucide-react no longer ships brand icons.
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

// The four main pages, with text, on screens wide enough to have no bottom
// tabs (xl); below that the tabs carry them and the header stays one row.
function MainLinks({ user }: { user: AuthenticatedUser }) {
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
      className="data-[current]:bg-primary/10 data-[current]:text-primary"
    >
      <CurrentLink href={href} page={tab.page}>
        <Icon />
        {tab.headerLabel}
      </CurrentLink>
    </Button>
  );
}

// The bar at the top of every page. Without a user (sign-in) it shows only
// the app name, the repository link and the theme switcher.
export function AppHeader({ user }: { user?: AuthenticatedUser | null }) {
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
        {user ? <MainLinks user={user} /> : null}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {user ? (
            <SiteMenu
              variant="header"
              role={user.role}
              demo={user.demo}
              {...menuIdentity(user)}
            />
          ) : null}
          <Button asChild variant="ghost" size="icon-sm" title="GitHub">
            <a href={repositoryUrl} target="_blank" rel="noopener noreferrer">
              <GitHubMark />
              <span className="sr-only">GitHub のリポジトリ（新しいタブ）</span>
            </a>
          </Button>
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}
