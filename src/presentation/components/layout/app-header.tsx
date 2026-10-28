import {
  CircleUserRound,
  CircleHelp,
  Eye,
  KeyRound,
  Languages,
  LogOut,
  MessageCircle,
  MessagesSquare,
  Shuffle,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { signOutAction } from "@/presentation/actions/auth-actions";
import { ThemeSwitcher } from "@/presentation/components/theme/theme-switcher";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";

const repositoryUrl = "https://github.com/Sparklingstadt/ffpf-zhuelog";

// The GitHub mark. lucide-react no longer ships brand icons.
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  children,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  children: string;
}) {
  return (
    <Button asChild variant="ghost" size="sm" title={children}>
      <Link href={href}>
        <Icon />
        <span className={label}>{children}</span>
      </Link>
    </Button>
  );
}

function UserControls({ user }: { user: AuthenticatedUser }) {
  const isGuest = user.role === "guest";
  const isMember = user.role === "member";
  const isAdmin = user.role === "admin";
  const name = isGuest
    ? "ゲスト"
    : isMember
      ? (user.displayName ?? user.githubLogin)
      : `@${user.githubLogin}`;
  const roleLabel = isAdmin ? "管理者" : isMember ? "メンバー" : null;
  // Labels collapse to icons until there is room for them; the text stays for
  // screen readers. Members' and admins' six links only fit with labels from
  // `xl`.
  // `max-*:sr-only` rather than `*:not-sr-only`, which resets the button's
  // `whitespace-nowrap` and lets a squeezed label wrap.
  const label = isGuest ? "max-lg:sr-only" : "max-xl:sr-only";

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 md:justify-end">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        {isGuest ? (
          <Eye className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <CircleUserRound className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium" title={name}>
          {name}
        </span>
        {roleLabel ? (
          <Badge variant="secondary" className="font-normal max-sm:hidden">
            {roleLabel}
          </Badge>
        ) : null}
      </div>
      <nav
        aria-label="アカウント"
        className="flex shrink-0 items-center gap-0.5"
      >
        <NavLink label={label} href="/practice/prepositions" icon={Shuffle}>
          介詞練習
        </NavLink>
        {isMember || isAdmin ? (
          <NavLink label={label} href="/follow" icon={UsersRound}>
            フォロー
          </NavLink>
        ) : null}
        {isMember || isAdmin ? (
          <NavLink label={label} href="/account/line" icon={MessageCircle}>
            LINE 連携
          </NavLink>
        ) : null}
        {isMember ? (
          <NavLink label={label} href="/account/password" icon={KeyRound}>
            パスワード変更
          </NavLink>
        ) : null}
        {isMember || isAdmin ? (
          <NavLink label={label} href="/chat" icon={MessagesSquare}>
            ChatGPT と話す
          </NavLink>
        ) : null}
        {isMember || isAdmin ? (
          <NavLink label={label} href="/quick-question" icon={CircleHelp}>
            クイック質問
          </NavLink>
        ) : null}
        {isAdmin ? (
          <NavLink label={label} href="/admin/accounts" icon={UserCog}>
            アカウント管理
          </NavLink>
        ) : null}
        <form action={signOutAction} className="shrink-0">
          <Button type="submit" variant="ghost" size="sm" title="ログアウト">
            <LogOut />
            <span className={label}>ログアウト</span>
          </Button>
        </form>
      </nav>
    </div>
  );
}

// The bar at the top of every page. Without a user (sign-in) it shows only
// the app name, the repository link and the theme switcher.
export function AppHeader({ user }: { user?: AuthenticatedUser | null }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 md:flex-nowrap lg:px-8">
        <Link
          href="/chat"
          className="flex shrink-0 items-center gap-2 rounded-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Languages className="size-4" />
          </span>
          学习録
        </Link>
        {user ? (
          <div className="order-last w-full min-w-0 border-t pt-2 md:order-none md:ml-auto md:w-auto md:border-0 md:pt-0">
            <UserControls user={user} />
          </div>
        ) : null}
        <div
          className={`flex items-center gap-1 ${user ? "ml-auto md:ml-0 md:border-l md:pl-4" : "ml-auto"}`}
        >
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
