import {
  CircleUserRound,
  Eye,
  KeyRound,
  LogOut,
  Users,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import type { AuthenticatedUser } from "@ffpf-zhuelog/core/domain/identity/entities/authenticated-user";
import { signOutAction } from "@/presentation/actions/auth-actions";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";

type AuthControlsProps = {
  user: AuthenticatedUser;
};

export function AuthControls({ user }: AuthControlsProps) {
  const isGuest = user.role === "guest";
  const isMember = user.role === "member";
  const isAdmin = user.role === "admin";
  const label = isGuest
    ? "ゲスト（自分のAPIキーでの添削のみ）"
    : isMember
      ? (user.displayName ?? user.githubLogin)
      : `@${user.githubLogin}`;
  const roleLabel = isAdmin ? "管理者" : isMember ? "メンバー" : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="gap-1.5 py-1.5 font-normal">
        {isGuest ? (
          <Eye className="size-3.5" />
        ) : (
          <CircleUserRound className="size-3.5" />
        )}
        {label}
      </Badge>
      {roleLabel ? (
        <Badge variant="secondary" className="py-1.5 font-normal">
          ロール：{roleLabel}
        </Badge>
      ) : null}
      {isMember || isAdmin ? (
        <Button asChild variant="ghost" size="sm">
          <Link href="/follow">
            <UsersRound />
            フォロー
          </Link>
        </Button>
      ) : null}
      {isMember ? (
        <Button asChild variant="ghost" size="sm">
          <Link href="/account/password">
            <KeyRound />
            パスワード変更
          </Link>
        </Button>
      ) : null}
      {isAdmin ? (
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/accounts">
            <Users />
            アカウント管理
          </Link>
        </Button>
      ) : null}
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut />
          ログアウト
        </Button>
      </form>
    </div>
  );
}
