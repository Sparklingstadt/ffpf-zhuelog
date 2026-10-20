import {
  CircleUserRound,
  Eye,
  KeyRound,
  Languages,
  LogOut,
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

// Labels collapse to icons below `lg`; the text stays for screen readers.
const label = "sr-only lg:not-sr-only";

function NavLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: LucideIcon;
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

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        {isGuest ? (
          <Eye className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <CircleUserRound className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium">{name}</span>
        {roleLabel ? (
          <Badge variant="secondary" className="font-normal">
            {roleLabel}
          </Badge>
        ) : null}
      </div>
      <nav aria-label="アカウント" className="flex items-center gap-0.5">
        {isMember || isAdmin ? (
          <NavLink href="/follow" icon={UsersRound}>
            フォロー
          </NavLink>
        ) : null}
        {isMember ? (
          <NavLink href="/account/password" icon={KeyRound}>
            パスワード変更
          </NavLink>
        ) : null}
        {isAdmin ? (
          <NavLink href="/admin/accounts" icon={UserCog}>
            アカウント管理
          </NavLink>
        ) : null}
        <form action={signOutAction}>
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
// the app name and the theme switcher.
export function AppHeader({ user }: { user?: AuthenticatedUser | null }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:flex-nowrap sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Languages className="size-4" />
          </span>
          学习録
        </Link>
        {user ? (
          <div className="order-last w-full border-t pt-2 sm:order-none sm:ml-auto sm:w-auto sm:border-0 sm:pt-0">
            <UserControls user={user} />
          </div>
        ) : null}
        <div
          className={user ? "ml-auto sm:ml-0 sm:border-l sm:pl-4" : "ml-auto"}
        >
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}
